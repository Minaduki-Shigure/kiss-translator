import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        // All translation runs in the web extension. Native messaging is neither
        // declared nor needed; never inspect, log, or echo a message payload.
        let error = NSError(
            domain: "KissTranslator.NativeMessaging",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Native messaging is not supported."]
        )
        context.cancelRequest(withError: error)
    }
}
