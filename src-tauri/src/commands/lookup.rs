//! Offline definitions from the user's active macOS dictionaries.

use serde::Serialize;

const MAX_QUERY_CHARS: usize = 256;

#[derive(Debug, Serialize)]
pub struct SelectionLookupResult {
    query: String,
    definition: Option<String>,
    source: String,
}

fn validate_query(text: &str) -> Result<String, String> {
    let query = text.trim();
    if query.is_empty() {
        return Err("Select a word or short phrase to look up.".into());
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(
            "Look up accepts at most 256 characters. Select a word or short phrase.".into(),
        );
    }
    if query.chars().any(char::is_control) {
        return Err("Select a word or phrase on one line to look up.".into());
    }
    Ok(query.into())
}

#[tauri::command]
pub async fn lookup_selection_text(text: String) -> Result<SelectionLookupResult, String> {
    let query = validate_query(&text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let definition = platform::definition(&query)?;
        Ok(SelectionLookupResult {
            query,
            definition,
            source: "Apple Dictionary".into(),
        })
    })
    .await
    .map_err(|error| format!("Dictionary lookup could not finish: {error}"))?
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn definition(_query: &str) -> Result<Option<String>, String> {
        Err("Local dictionary lookup is currently available on macOS only.".into())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{ffi::c_void, ptr, sync::Mutex};

    type CFStringRef = *const c_void;

    #[repr(C)]
    struct CFRange {
        location: isize,
        length: isize,
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithBytes(
            allocator: *const c_void,
            bytes: *const u8,
            count: isize,
            encoding: u32,
            external: u8,
        ) -> CFStringRef;
        fn CFStringGetLength(string: CFStringRef) -> isize;
        fn CFStringGetCharacters(string: CFStringRef, range: CFRange, buffer: *mut u16);
        fn CFRelease(value: *const c_void);
    }

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        // Public API returns a retained CFString; null dictionary searches active dictionaries.
        // https://developer.apple.com/documentation/coreservices/1446842-dcscopytextdefinition
        fn DCSCopyTextDefinition(
            dictionary: *const c_void,
            text: CFStringRef,
            range: CFRange,
        ) -> CFStringRef;
    }

    struct OwnedString(CFStringRef);

    impl Drop for OwnedString {
        fn drop(&mut self) {
            // Only constructed from non-null Create/Copy results owned by this module.
            unsafe { CFRelease(self.0) };
        }
    }

    // Keep DictionaryServices initialization and calls serialized, away from the UI thread.
    static DICTIONARY: Mutex<()> = Mutex::new(());

    pub fn definition(query: &str) -> Result<Option<String>, String> {
        let _guard = DICTIONARY
            .lock()
            .map_err(|_| "Dictionary lookup is unavailable.")?;
        unsafe {
            let text = CFStringCreateWithBytes(
                ptr::null(),
                query.as_ptr(),
                query.len() as isize,
                0x08000100, // kCFStringEncodingUTF8
                0,
            );
            if text.is_null() {
                return Err("Could not prepare the dictionary query.".into());
            }
            let text = OwnedString(text);
            let result = DCSCopyTextDefinition(
                ptr::null(),
                text.0,
                CFRange {
                    location: 0,
                    length: CFStringGetLength(text.0),
                },
            );
            if result.is_null() {
                return Ok(None);
            }
            let result = OwnedString(result);
            let length = CFStringGetLength(result.0);
            // Bound allocation even if a third-party installed dictionary returns huge content.
            if !(0..=1_000_000).contains(&length) {
                return Err("The dictionary definition is too large to display.".into());
            }
            let mut characters = vec![0u16; length as usize];
            CFStringGetCharacters(
                result.0,
                CFRange {
                    location: 0,
                    length,
                },
                characters.as_mut_ptr(),
            );
            let definition = String::from_utf16_lossy(&characters).trim().to_owned();
            Ok((!definition.is_empty()).then_some(definition))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_words_and_unicode_phrases_without_byte_limits() {
        assert_eq!(validate_query("  déjà vu  ").unwrap(), "déjà vu");
        assert!(validate_query(&"📝".repeat(256)).is_ok());
        assert!(validate_query(&"📝".repeat(257)).is_err());
    }

    #[test]
    fn rejects_empty_multiline_and_control_character_queries() {
        for text in ["", " \n ", "one\ntwo", "word\0", "one\ttwo"] {
            assert!(validate_query(text).is_err(), "{text:?}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_dictionary_handles_unicode_and_missing_entries() {
        // Installed dictionaries vary by machine, so no English entry is assumed.
        for query in [
            "writing",
            "déjà vu",
            "📝",
            "bustermarknonexistentwordxyz987654321",
        ] {
            let definition = platform::definition(query).unwrap();
            if let Some(definition) = definition {
                assert!(!definition.trim().is_empty());
            }
        }
    }
}
