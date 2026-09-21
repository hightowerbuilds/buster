fn main() {
    println!("cargo:rerun-if-changed=src/speech_bridge.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/speech_bridge.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("buster_speech");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
    }
    tauri_build::build()
}
