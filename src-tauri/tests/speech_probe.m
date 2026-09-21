// Run on macOS with the ordinary user audio/voice services available:
// xcrun clang -fobjc-arc -fblocks src-tauri/src/speech_bridge.m \
//   src-tauri/tests/speech_probe.m -framework AVFoundation -framework Foundation \
//   -o /tmp/bustermark-speech-probe && /tmp/bustermark-speech-probe
// Default volume is zero; pass --audible for one short phrase at 20% volume.
// This probe never reads user documents.
#import <Foundation/Foundation.h>

extern char *bm_speech_voices(void);
extern char *bm_speech_start(const char *, void (*)(const char *));
extern char *bm_speech_control(const char *, const char *);
extern void bm_speech_shutdown(void);
extern void bm_speech_free(char *);

static NSString *voiceId;
static int stage;
static BOOL gotProgress;
static BOOL audible;
static NSString *textA = @"Writing 📝 is a way to explore ideas. This sentence gives the playback controls enough time to pause and resume speech.";
static NSString *textB;

static NSDictionary *response(char *raw) {
    NSCAssert(raw, @"Missing native response");
    NSData *data = [[NSString stringWithUTF8String:raw] dataUsingEncoding:NSUTF8StringEncoding];
    bm_speech_free(raw);
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSCAssert([value isKindOfClass:[NSDictionary class]], @"Invalid native response");
    return value;
}

static void event(const char *raw);
static NSDictionary *start(NSString *jobId, NSString *text, NSString *voice) {
    NSDictionary *request = @{@"jobId":jobId, @"text":text, @"voiceId":voice, @"rate":@0.5,
                              @"volume": @((audible && [jobId isEqual:@"probe_b"]) ? 0.2 : 0.0)};
    NSData *data = [NSJSONSerialization dataWithJSONObject:request options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return response(bm_speech_start(json.UTF8String, event));
}
static void requireSuccess(NSDictionary *value) { NSCAssert(!value[@"error"], @"%@", value[@"error"]); }

static void event(const char *raw) {
    NSData *data = [[NSString stringWithUTF8String:raw] dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    // Real Tauri events are asynchronous to native controls. Preserve that here.
    dispatch_async(dispatch_get_main_queue(), ^{
        NSCAssert(![value[@"state"] isEqual:@"failed"], @"Native failure: %@", value);
        NSString *job = value[@"jobId"];
        NSString *state = value[@"state"];
        if (value[@"start"]) {
            NSString *text = [job isEqual:@"probe_a"] ? textA : textB;
            NSUInteger offset = [value[@"start"] unsignedIntegerValue];
            NSUInteger length = [value[@"length"] unsignedIntegerValue];
            NSCAssert(offset <= text.length && length <= text.length - offset, @"Progress outside UTF-16 text");
            if (offset < text.length) {
                unichar first = [text characterAtIndex:offset];
                NSCAssert(first < 0xdc00 || first > 0xdfff, @"Progress split a surrogate pair");
            }
            if (length > 0) {
                unichar last = [text characterAtIndex:offset + length - 1];
                NSCAssert(last < 0xd800 || last > 0xdbff, @"Progress split a surrogate pair");
            }
        }
        if (stage == 0 && [job isEqual:@"probe_a"] && value[@"start"]) {
            NSCAssert([value[@"length"] unsignedIntegerValue] > 0, @"Empty speech range");
            gotProgress = YES;
            stage = 1;
            requireSuccess(response(bm_speech_control("probe_a", "pause")));
        } else if (stage == 1 && [state isEqual:@"paused"]) {
            stage = 2;
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                requireSuccess(response(bm_speech_control("probe_a", "resume")));
            });
        } else if (stage == 2 && [state isEqual:@"speaking"] && value[@"start"] && [value[@"start"] unsignedIntegerValue] >= 11) {
            stage = 3;
            requireSuccess(response(bm_speech_control("probe_a", "stop")));
            requireSuccess(start(@"probe_b", textB, voiceId));
            NSCAssert(response(bm_speech_control("probe_a", "stop"))[@"error"], @"Stale stop affected new job");
        } else if (stage >= 3 && [job isEqual:@"probe_b"] && [state isEqual:@"completed"]) {
            NSCAssert(gotProgress, @"No word progress received");
            NSCAssert(response(bm_speech_control("probe_b", "pause"))[@"error"], @"Finished job remained active");
            puts("PASS: native speech voices, UTF-16 progress, pause, resume, stop, stale control, restart, completion");
            if (audible) puts("PASS: nonzero-volume playback reported completed (20% volume)");
            bm_speech_shutdown();
            exit(0);
        }
    });
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        audible = argc > 1 && strcmp(argv[1], "--audible") == 0;
        textB = audible ? @"Reading selected text aloud." : @"Hello.";
        setbuf(stdout, NULL);
        NSDictionary *listed = response(bm_speech_voices());
        requireSuccess(listed);
        NSArray *voices = listed[@"voices"];
        if (voices.count == 0) { fputs("No installed speech voices.\n", stderr); return 77; }
        NSDictionary *preferred;
        for (NSDictionary *voice in voices) {
            NSCAssert(voice[@"id"] && voice[@"name"] && voice[@"language"] && voice[@"quality"], @"Incomplete voice metadata");
            if ([voice[@"language"] isEqual:@"en-US"]) { preferred = voice; break; }
        }
        voiceId = (preferred ?: voices.firstObject)[@"id"];
        printf("Installed voices: %lu; test voice: %s\n", (unsigned long)voices.count, voiceId.UTF8String);
        NSCAssert(start(@"missing", @"Hello", @"buster.missing.voice")[@"error"], @"Missing voice was accepted");
        requireSuccess(start(@"probe_a", textA, voiceId));
        NSCAssert(start(@"busy", @"Hello", voiceId)[@"error"], @"Concurrent speech was accepted");
        NSCAssert(response(bm_speech_control("wrong_job", "stop"))[@"error"], @"Stale job ID accepted");
        NSCAssert(response(bm_speech_control("probe_a", "invalid"))[@"error"], @"Invalid action accepted");
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            fprintf(stderr, "Speech probe timed out at stage %d.\n", stage);
            bm_speech_shutdown();
            exit(1);
        });
        [[NSRunLoop mainRunLoop] run];
    }
    return 1;
}
