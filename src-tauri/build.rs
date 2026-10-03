fn main() {
    println!("cargo:rerun-if-changed=src/speech_bridge.m");
    println!("cargo:rerun-if-changed=src/print_bridge.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/speech_bridge.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("buster_speech");
        cc::Build::new()
            .file("src/print_bridge.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("buster_print");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
    }
    tauri_build::build()
}
