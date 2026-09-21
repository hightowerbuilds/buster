//! Local macOS speech. The Objective-C bridge owns all AVFoundation objects on
//! the app's main thread; only owned JSON values cross the FFI boundary.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeechRequest {
    pub job_id: String,
    pub text: String,
    pub voice_id: String,
    pub rate: f32,
    pub volume: f32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SpeechVoice {
    id: String,
    name: String,
    language: String,
    quality: u32,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(
            "Speech job ID must contain 1–128 letters, numbers, underscores, or hyphens.".into(),
        );
    }
    Ok(())
}

fn validate_request(request: &SpeechRequest) -> Result<(), String> {
    validate_id(&request.job_id)?;
    if request.text.trim().is_empty()
        || request.text.len() > 32 * 1024
        || request.text.contains('\0')
    {
        return Err("Select nonempty text of at most 32 KiB to read aloud.".into());
    }
    if request.voice_id.is_empty()
        || request.voice_id.len() > 512
        || request.voice_id.chars().any(char::is_control)
    {
        return Err("Choose an installed macOS voice.".into());
    }
    if !request.rate.is_finite() || !(0.1..=1.0).contains(&request.rate) {
        return Err("Speech rate must be between 0.1 and 1.0.".into());
    }
    if !request.volume.is_finite() || !(0.0..=1.0).contains(&request.volume) {
        return Err("Speech volume must be between 0 and 1.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn speech_voices(app: tauri::AppHandle) -> Result<Vec<SpeechVoice>, String> {
    platform::voices(app).await
}

#[tauri::command]
pub async fn speech_start(app: tauri::AppHandle, request: SpeechRequest) -> Result<(), String> {
    validate_request(&request)?;
    platform::start(app, request).await
}

#[tauri::command]
pub async fn speech_control(
    app: tauri::AppHandle,
    job_id: String,
    action: String,
) -> Result<(), String> {
    validate_id(&job_id)?;
    if !["pause", "resume", "stop"].contains(&action.as_str()) {
        return Err("Speech control must be pause, resume, or stop.".into());
    }
    platform::control(app, job_id, action).await
}

pub fn shutdown() {
    platform::shutdown();
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    const UNSUPPORTED: &str = "Apple speech playback is available on macOS only.";
    pub async fn voices(_: tauri::AppHandle) -> Result<Vec<SpeechVoice>, String> {
        Err(UNSUPPORTED.into())
    }
    pub async fn start(_: tauri::AppHandle, _: SpeechRequest) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub async fn control(_: tauri::AppHandle, _: String, _: String) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn shutdown() {}
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::{
        ffi::{c_char, CStr, CString},
        sync::OnceLock,
    };
    use tauri::Emitter;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    extern "C" {
        fn bm_speech_voices() -> *mut c_char;
        fn bm_speech_start(
            request: *const c_char,
            callback: extern "C" fn(*const c_char),
        ) -> *mut c_char;
        fn bm_speech_control(job_id: *const c_char, action: *const c_char) -> *mut c_char;
        fn bm_speech_shutdown();
        fn bm_speech_free(value: *mut c_char);
    }

    extern "C" fn event_callback(json: *const c_char) {
        if json.is_null() {
            return;
        }
        // The bridge keeps this pointer valid until this callback returns.
        let bytes = unsafe { CStr::from_ptr(json) }.to_bytes();
        if let (Some(app), Ok(event)) = (
            APP.get(),
            serde_json::from_slice::<serde_json::Value>(bytes),
        ) {
            let _ = app.emit("speech-event", event);
        }
    }

    unsafe fn take_response(raw: *mut c_char) -> Result<serde_json::Value, String> {
        if raw.is_null() {
            return Err("macOS speech returned no response.".into());
        }
        let parsed = serde_json::from_slice::<serde_json::Value>(CStr::from_ptr(raw).to_bytes());
        bm_speech_free(raw);
        let value = parsed.map_err(|_| "macOS speech returned an invalid response.".to_owned())?;
        if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
            return Err(error.to_owned());
        }
        Ok(value)
    }

    async fn on_main<T: Send + 'static>(
        app: tauri::AppHandle,
        run: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(run());
        })
        .map_err(|_| "The speech service is unavailable.".to_owned())?;
        rx.await
            .map_err(|_| "The speech service closed before responding.".to_owned())?
    }

    pub async fn voices(app: tauri::AppHandle) -> Result<Vec<SpeechVoice>, String> {
        on_main(app, || {
            let mut value = unsafe { take_response(bm_speech_voices()) }?;
            serde_json::from_value(value["voices"].take())
                .map_err(|_| "macOS returned an invalid voice list.".into())
        })
        .await
    }

    pub async fn start(app: tauri::AppHandle, request: SpeechRequest) -> Result<(), String> {
        let _ = APP.set(app.clone());
        let json = CString::new(serde_json::to_string(&request).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        on_main(app, move || unsafe {
            take_response(bm_speech_start(json.as_ptr(), event_callback)).map(|_| ())
        })
        .await
    }

    pub async fn control(
        app: tauri::AppHandle,
        job_id: String,
        action: String,
    ) -> Result<(), String> {
        let job_id = CString::new(job_id).map_err(|e| e.to_string())?;
        let action = CString::new(action).map_err(|e| e.to_string())?;
        on_main(app, move || unsafe {
            take_response(bm_speech_control(job_id.as_ptr(), action.as_ptr())).map(|_| ())
        })
        .await
    }

    pub fn shutdown() {
        unsafe { bm_speech_shutdown() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> SpeechRequest {
        SpeechRequest {
            job_id: "speech_abc-123".into(),
            text: "Hello, 📝 writing.".into(),
            voice_id: "com.apple.voice.compact.en-US.Samantha".into(),
            rate: 0.5,
            volume: 1.0,
        }
    }
    #[test]
    fn accepts_unicode_text_and_option_boundaries() {
        let mut value = request();
        assert!(validate_request(&value).is_ok());
        for (rate, volume) in [(0.1, 0.0), (1.0, 1.0)] {
            value.rate = rate;
            value.volume = volume;
            assert!(validate_request(&value).is_ok());
        }
    }
    #[test]
    fn rejects_invalid_job_identifiers() {
        for id in ["", "a\0b", "with space", "../job", &"x".repeat(129)] {
            assert!(validate_id(id).is_err());
        }
    }
    #[test]
    fn bounds_utf8_text_without_truncating_it() {
        let mut value = request();
        value.text = "📝".repeat(8192);
        assert!(validate_request(&value).is_ok());
        value.text.push('a');
        assert!(validate_request(&value).is_err());
        for text in ["", " \n\t ", "a\0b"] {
            value.text = text.into();
            assert!(validate_request(&value).is_err());
        }
    }
    #[test]
    fn rejects_bad_voice_and_nonfinite_or_out_of_range_options() {
        let mut value = request();
        for voice in ["", "voice\0", &"v".repeat(513)] {
            value.voice_id = voice.into();
            assert!(validate_request(&value).is_err());
        }
        value = request();
        for rate in [f32::NAN, f32::INFINITY, 0.0, 1.1] {
            value.rate = rate;
            assert!(validate_request(&value).is_err());
        }
        value = request();
        for volume in [f32::NAN, f32::NEG_INFINITY, -0.1, 1.1] {
            value.volume = volume;
            assert!(validate_request(&value).is_err());
        }
    }
    #[test]
    fn request_schema_rejects_unknown_fields_and_missing_options() {
        let mut value = serde_json::to_value(request()).unwrap();
        value["surprise"] = true.into();
        assert!(serde_json::from_value::<SpeechRequest>(value).is_err());
        let mut value = serde_json::to_value(request()).unwrap();
        value.as_object_mut().unwrap().remove("voiceId");
        assert!(serde_json::from_value::<SpeechRequest>(value).is_err());
    }
}
