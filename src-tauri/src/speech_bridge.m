// AVSpeechSynthesizer ownership lives on the macOS main thread. This bridge has
// no queues of text: each accepted job owns one synthesizer and one utterance.
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

typedef void (*BMSpeechCallback)(const char *json);

static char *BMJSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (!data) return strdup("{\"error\":\"Could not encode speech response.\"}");
    char *result = malloc(data.length + 1);
    memcpy(result, data.bytes, data.length);
    result[data.length] = '\0';
    return result;
}

@interface BMSpeechController : NSObject <AVSpeechSynthesizerDelegate>
@property(nonatomic, strong) AVSpeechSynthesizer *synthesizer;
@property(nonatomic, strong) AVSpeechUtterance *utterance;
@property(nonatomic, copy) NSString *jobId;
@property(nonatomic, assign) BMSpeechCallback callback;
@property(nonatomic, assign) BOOL started;
@property(nonatomic, assign) BOOL pauseRequested;
@end

@implementation BMSpeechController
- (void)emit:(NSString *)state range:(NSRange)range error:(NSString *)error {
    if (!self.callback || !self.jobId) return;
    NSMutableDictionary *event = [@{@"jobId": self.jobId, @"state": state} mutableCopy];
    if (range.location != NSNotFound) {
        event[@"start"] = @(range.location);
        event[@"length"] = @(range.length);
    }
    if (error) event[@"error"] = error;
    char *json = BMJSON(event);
    self.callback(json); // Rust copies the payload during this synchronous call.
    free(json);
}
- (void)clear {
    self.synthesizer.delegate = nil;
    self.synthesizer = nil;
    self.utterance = nil;
    self.jobId = nil;
    self.started = NO;
    self.pauseRequested = NO;
}
- (void)stopWithState:(NSString *)state error:(NSString *)error {
    AVSpeechSynthesizer *old = self.synthesizer;
    old.delegate = nil; // Cancellation callbacks cannot race the next job.
    [old stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    [self emit:state range:NSMakeRange(NSNotFound, 0) error:error];
    [self clear];
}
- (void)event:(NSString *)state synthesizer:(AVSpeechSynthesizer *)synthesizer
    utterance:(AVSpeechUtterance *)utterance range:(NSRange)range {
    // Apple's callbacks are marshalled even if an OS release changes their queue.
    void (^deliver)(void) = ^{
        if (self.synthesizer != synthesizer || self.utterance != utterance) return;
        NSString *emittedState = state;
        if ([state isEqualToString:@"resumed"]) {
            if (synthesizer.paused) return;
            self.pauseRequested = NO;
            emittedState = @"speaking";
        }
        if ([state isEqualToString:@"speaking"]) {
            self.started = YES;
            if (range.location != NSNotFound &&
                (range.location > utterance.speechString.length ||
                 range.length > utterance.speechString.length - range.location)) return;
            if (self.pauseRequested) return;
        }
        if ([state isEqualToString:@"paused"] && !self.pauseRequested) return;
        if ([state isEqualToString:@"completed"]) {
            [self emit:emittedState range:range error:nil];
            [self clear];
        } else if ([state isEqualToString:@"failed"]) {
            [self emit:state range:range error:@"macOS canceled speech playback."];
            [self clear];
        } else {
            [self emit:emittedState range:range error:nil];
        }
    };
    if ([NSThread isMainThread]) deliver();
    else dispatch_async(dispatch_get_main_queue(), deliver);
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)s didStartSpeechUtterance:(AVSpeechUtterance *)u {
    [self event:@"speaking" synthesizer:s utterance:u range:NSMakeRange(NSNotFound, 0)];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)s didFinishSpeechUtterance:(AVSpeechUtterance *)u {
    [self event:@"completed" synthesizer:s utterance:u range:NSMakeRange(NSNotFound, 0)];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)s didPauseSpeechUtterance:(AVSpeechUtterance *)u {
    [self event:@"paused" synthesizer:s utterance:u range:NSMakeRange(NSNotFound, 0)];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)s didContinueSpeechUtterance:(AVSpeechUtterance *)u {
    [self event:@"resumed" synthesizer:s utterance:u range:NSMakeRange(NSNotFound, 0)];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)s didCancelSpeechUtterance:(AVSpeechUtterance *)u {
    [self event:@"failed" synthesizer:s utterance:u range:NSMakeRange(NSNotFound, 0)];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)s willSpeakRangeOfSpeechString:(NSRange)range utterance:(AVSpeechUtterance *)u {
    [self event:@"speaking" synthesizer:s utterance:u range:range];
}
@end

static BMSpeechController *controller;

// Every exported entry point is called on the app's main thread. Return values
// are owned C strings; the caller always releases them with bm_speech_free.
char *bm_speech_voices(void) {
    @autoreleasepool {
        if (![NSThread isMainThread]) return BMJSON(@{@"error": @"Speech requires the main thread."});
        NSMutableArray *voices = [NSMutableArray array];
        for (AVSpeechSynthesisVoice *voice in [AVSpeechSynthesisVoice speechVoices]) {
            [voices addObject:@{@"id": voice.identifier, @"name": voice.name,
                                @"language": voice.language, @"quality": @(voice.quality)}];
        }
        return BMJSON(@{@"voices": voices});
    }
}

char *bm_speech_start(const char *requestJSON, BMSpeechCallback callback) {
    @autoreleasepool {
        if (![NSThread isMainThread]) return BMJSON(@{@"error": @"Speech requires the main thread."});
        NSData *data = [[NSString stringWithUTF8String:requestJSON] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (!controller) controller = [BMSpeechController new];
        if (controller.utterance) return BMJSON(@{@"error": @"Speech is already running. Stop it before starting another selection."});
        // Rust validates all fields and bounds before crossing this private FFI.
        AVSpeechSynthesisVoice *voice = [AVSpeechSynthesisVoice voiceWithIdentifier:request[@"voiceId"]];
        if (!voice) return BMJSON(@{@"error": @"This macOS voice is unavailable. Refresh the installed voices."});
        AVSpeechUtterance *utterance = [[AVSpeechUtterance alloc] initWithString:request[@"text"]];
        utterance.voice = voice;
        utterance.rate = [request[@"rate"] floatValue];
        utterance.volume = [request[@"volume"] floatValue];
        AVSpeechSynthesizer *synthesizer = [AVSpeechSynthesizer new];
        controller.jobId = request[@"jobId"];
        controller.callback = callback;
        controller.utterance = utterance;
        controller.synthesizer = synthesizer;
        controller.started = NO;
        controller.pauseRequested = NO;
        synthesizer.delegate = controller;
        [synthesizer speakUtterance:utterance];
        // Some missing/corrupt system voice assets never produce a delegate event.
        __weak AVSpeechSynthesizer *watchedSynthesizer = synthesizer;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            AVSpeechSynthesizer *watched = watchedSynthesizer;
            if (watched && controller.synthesizer == watched && !controller.started) {
                [controller stopWithState:@"failed" error:@"macOS did not start this voice. Try another installed voice."];
            }
        });
        return BMJSON(@{});
    }
}

char *bm_speech_control(const char *jobId, const char *action) {
    @autoreleasepool {
        if (![NSThread isMainThread]) return BMJSON(@{@"error": @"Speech requires the main thread."});
        if (!controller.utterance || ![controller.jobId isEqualToString:[NSString stringWithUTF8String:jobId]])
            return BMJSON(@{@"error": @"This speech job is no longer active."});
        NSString *command = [NSString stringWithUTF8String:action];
        if ([command isEqualToString:@"stop"]) {
            [controller stopWithState:@"stopped" error:nil];
        } else if ([command isEqualToString:@"pause"]) {
            if (!controller.pauseRequested && !controller.synthesizer.paused) {
                controller.pauseRequested = YES;
                if (![controller.synthesizer pauseSpeakingAtBoundary:AVSpeechBoundaryImmediate]) {
                    controller.pauseRequested = NO;
                    return BMJSON(@{@"error": @"macOS could not pause speech yet. Try again when playback starts."});
                }
            }
        } else if ([command isEqualToString:@"resume"]) {
            if (controller.pauseRequested || controller.synthesizer.paused) {
                controller.pauseRequested = NO;
                if (![controller.synthesizer continueSpeaking]) {
                    controller.pauseRequested = YES;
                    return BMJSON(@{@"error": @"macOS could not resume speech yet. Try again when it is paused."});
                }
            }
        } else return BMJSON(@{@"error": @"Unknown speech control."});
        return BMJSON(@{});
    }
}

void bm_speech_shutdown(void) {
    if ([NSThread isMainThread] && controller.utterance) [controller stopWithState:@"stopped" error:nil];
}
void bm_speech_free(char *value) { free(value); }
