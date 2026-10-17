import SwiftUI

@main
struct VUEMeshTVApp: App {
    @StateObject private var client = DisplayClient()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(client)
        }
    }
}
