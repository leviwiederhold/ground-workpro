import Capacitor

/// Registers the app-target Capacitor plugins.
///
/// Capacitor's generated `packageClassList` contains Swift Package plugins such
/// as Geolocation, but it does not discover Swift plugin classes compiled
/// directly into the app target. Without explicit registration the three
/// attendance classes exist in the binary while `Capacitor.Plugins.*` remains
/// undefined, so device credential enrollment can never complete.
final class GroundworkBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        bridge?.registerPluginInstance(JobsiteGeofencePlugin())
        bridge?.registerPluginInstance(AttendanceQueueStorePlugin())
        bridge?.registerPluginInstance(SecureAttendanceStorePlugin())
    }
}
