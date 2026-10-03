// Dedicated, script-free WebKit document. Never print the app's UI webview.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <ApplicationServices/ApplicationServices.h>

typedef void (*BMPrintCallback)(const char *json);
static char *BMPrintJSON(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (!data) return strdup("{\"error\":\"Could not encode print response.\"}");
    char *result = malloc(data.length + 1);
    memcpy(result, data.bytes, data.length); result[data.length] = '\0';
    return result;
}

@interface BMPrintJob : NSObject <WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSPrintOperation *operation;
@property(nonatomic, strong) NSDictionary *request;
@property(nonatomic, assign) BMPrintCallback callback;
@property(nonatomic, assign) BOOL started;
@property(nonatomic, assign) BOOL finished;
- (void)finish:(NSString *)error;
@end
static BMPrintJob *activeJob;

@implementation BMPrintJob
- (void)finish:(NSString *)error {
    if (self.finished) return;
    self.finished = YES;
    NSMutableDictionary *result = [@{@"jobId": self.request[@"jobId"]} mutableCopy];
    if (error) result[@"error"] = error;
    else result[@"ok"] = @YES;
    char *json = BMPrintJSON(result);
    self.callback(json); free(json);
    self.webView.navigationDelegate = nil;
    [self.webView stopLoading];
    // Release WebKit and AppKit objects on the main thread after delegate return.
    dispatch_async(dispatch_get_main_queue(), ^{
        self.operation = nil;
        self.webView = nil;
        self.window.contentView = nil;
        [self.window close]; self.window = nil;
        if (activeJob == self) activeJob = nil;
    });
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self finish:@"The print document could not be loaded."];
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self finish:@"The print document could not be loaded."];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    [self finish:@"The print renderer stopped. Your note remains open."];
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSString *scheme = action.request.URL.scheme;
    decisionHandler([scheme isEqualToString:@"about"] || [scheme isEqualToString:@"data"]
        ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if (self.started || self.finished) return;
    self.started = YES;
    NSDictionary *options = self.request[@"options"];
    NSPrintInfo *info = [[NSPrintInfo sharedPrintInfo] copy];
    BOOL pdf = [options[@"destination"] isEqualToString:@"pdf"];
    if (!pdf) {
        NSString *name = options[@"printerId"];
        if (![[NSPrinter printerNames] containsObject:name]) { [self finish:@"This printer is no longer installed. Choose another destination."]; return; }
        info.printer = [NSPrinter printerWithName:name];
        info.jobDisposition = NSPrintSpoolJob;
    } else {
        info.jobDisposition = NSPrintSaveJob;
        info.dictionary[NSPrintJobSavingURL] = [NSURL fileURLWithPath:self.request[@"pdfPath"]];
    }
    NSString *paper = options[@"paper"];
    info.paperSize = [paper isEqualToString:@"a4"] ? NSMakeSize(595.276, 841.89)
        : [paper isEqualToString:@"legal"] ? NSMakeSize(612, 1008) : NSMakeSize(612, 792);
    info.orientation = [options[@"orientation"] isEqualToString:@"landscape"] ? NSPaperOrientationLandscape : NSPaperOrientationPortrait;
    info.topMargin = info.bottomMargin = info.leftMargin = info.rightMargin = 36;
    info.horizontallyCentered = NO; info.verticallyCentered = NO;
    info.horizontalPagination = NSPrintingPaginationModeFit;
    info.verticalPagination = NSPrintingPaginationModeAutomatic;
    info.dictionary[NSPrintCopies] = pdf ? @1 : options[@"copies"];
    BOOL allPages = [options[@"pages"] isEqualToString:@"all"];
    info.dictionary[NSPrintAllPages] = @(allPages);
    if (!allPages) {
        info.dictionary[NSPrintFirstPage] = options[@"firstPage"];
        info.dictionary[NSPrintLastPage] = options[@"lastPage"];
    }
    NSString *sides = options[@"duplex"];
    PMDuplexMode duplex = [sides isEqualToString:@"two-sided-long-edge"] ? kPMDuplexNoTumble
        : [sides isEqualToString:@"two-sided-short-edge"] ? kPMDuplexTumble : kPMDuplexNone;
    if (PMSetDuplex((PMPrintSettings)info.PMPrintSettings, duplex) != noErr) {
        [self finish:@"macOS could not apply the selected print sides."]; return;
    }
    [info updateFromPMPrintSettings];
    [self.window setContentSize:NSMakeSize(MAX(100, info.paperSize.width - 72), MAX(100, info.paperSize.height - 72))];
    if (@available(macOS 11.0, *)) {
        self.operation = [webView printOperationWithPrintInfo:info];
        self.operation.jobTitle = self.request[@"title"];
        self.operation.showsPrintPanel = NO; // The BusterMark modal already confirmed this job.
        self.operation.showsProgressPanel = NO;
        [self.operation runOperationModalForWindow:self.window delegate:self
            didRunSelector:@selector(printOperation:didRun:contextInfo:) contextInfo:NULL];
    } else [self finish:@"Printing requires macOS 11 or later."];
}
- (void)printOperation:(NSPrintOperation *)operation didRun:(BOOL)success contextInfo:(void *)contextInfo {
    [self finish:success ? nil : @"macOS could not complete the print job. Check the printer queue before trying again."];
}
@end

char *bm_print_printers(void) {
    @autoreleasepool {
        NSMutableArray *printers = [NSMutableArray array];
        NSString *defaultName = [NSPrintInfo sharedPrintInfo].printer.name;
        for (NSString *name in [NSPrinter printerNames]) {
            [printers addObject:@{@"id": name, @"name": name, @"isDefault": @([name isEqualToString:defaultName])}];
        }
        return BMPrintJSON(printers);
    }
}

char *bm_print_start(const char *requestJSON, BMPrintCallback callback) {
    @autoreleasepool {
        if (![NSThread isMainThread]) return BMPrintJSON(@{@"error": @"Printing requires the main thread."});
        if (activeJob) return BMPrintJSON(@{@"error": @"Another print job is still being prepared."});
        NSData *data = [[NSString stringWithUTF8String:requestJSON] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (!request || !callback) return BMPrintJSON(@{@"error": @"The print request is invalid."});
        BMPrintJob *job = [BMPrintJob new];
        job.request = request; job.callback = callback;
        WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
        configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
        if (@available(macOS 11.0, *)) configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
        job.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 1000)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        job.window.releasedWhenClosed = NO;
        job.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 1000) configuration:configuration];
        job.webView.navigationDelegate = job;
        job.window.contentView = job.webView; // Retained, sized document; never shown or focused.
        activeJob = job;
        NSString *html = [NSString stringWithFormat:@"<!doctype html><html><head><meta charset='utf-8'>"
            "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
            "<style>html,body{margin:0;padding:0;color:#111;background:#fff}body{font:12pt Georgia,serif;line-height:1.5}"
            "header{font:9pt -apple-system,sans-serif;color:#555;padding-bottom:12pt;margin-bottom:16pt;border-bottom:1px solid #ddd}"
            "h1,h2,h3,h4,h5,h6{line-height:1.2;break-after:avoid}p,li{orphans:3;widows:3}"
            "pre,code{font-family:Menlo,monospace;font-size:10pt}pre{white-space:pre-wrap;overflow-wrap:anywhere}"
            ".plain-text{font:11pt Menlo,monospace}blockquote{margin-left:0;padding-left:16pt;border-left:2px solid #bbb}"
            "table{border-collapse:collapse;width:100%%}th,td{border:1px solid #ccc;padding:5pt;text-align:left}"
            "thead{display:table-header-group}tr,pre{break-inside:avoid}a{color:inherit;text-decoration:underline}"
            "article{overflow-wrap:anywhere}</style></head><body>%@</body></html>", request[@"html"]];
        [job.webView loadHTMLString:html baseURL:nil];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            if (!job.started && !job.finished) [job finish:@"The print document took too long to load. Try again."];
        });
        return BMPrintJSON(@{});
    }
}
void bm_print_free(char *value) { free(value); }
