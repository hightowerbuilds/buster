//! WGSL note backgrounds. Shaders are written in WGSL, validated and translated to GLSL ES 3.00 with
//! naga, and drawn with WebGL2 because WebKitGTK does not yet provide WebGPU. Saved shaders live in
//! the app config directory as `backgrounds/<id>.wgsl` with an `index.json` of names and settings.
use naga::back::glsl;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use tauri::{command, AppHandle, Manager};

/// Appended after the writer's shader; WGSL declarations are order-independent, so error line
/// numbers still match the shader as written.
pub const PRELUDE: &str = "
struct Uniforms { resolution: vec2f, time: f32, strength: f32, accent: vec4f, paper: vec4f, ink: vec4f }
@group(0) @binding(0) var<uniform> u: Uniforms;
";
pub const ENTRY_POINT: &str = "fs_main";
const MAX_SOURCE: usize = 64 * 1024;

/// Validates a fragment shader and returns its GLSL ES 3.00 translation, or a readable error.
pub fn compile(wgsl: &str) -> Result<String, String> {
    if wgsl.trim().is_empty() || wgsl.len() > MAX_SOURCE {
        return Err("A background shader must contain between 1 byte and 64 KiB of WGSL.".into());
    }
    let source = format!("{wgsl}\n{PRELUDE}");
    let module = naga::front::wgsl::parse_str(&source).map_err(|e| e.emit_to_string(&source))?;
    if !module.entry_points.iter().any(|ep| ep.name == ENTRY_POINT && ep.stage == naga::ShaderStage::Fragment) {
        return Err("Define the entry point `@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f`.".into());
    }
    let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&module)
        .map_err(|e| e.emit_to_string(&source))?;
    let options = glsl::Options {
        version: glsl::Version::Embedded { version: 300, is_webgl: true },
        writer_flags: glsl::WriterFlags::empty(),
        ..Default::default()
    };
    let pipeline = glsl::PipelineOptions { shader_stage: naga::ShaderStage::Fragment, entry_point: ENTRY_POINT.into(), multiview: None };
    let mut out = String::new();
    let mut writer = glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
        .map_err(|e| format!("The shader cannot be drawn with WebGL2: {e}"))?;
    let reflection = writer.write().map_err(|e| format!("The shader cannot be drawn with WebGL2: {e}"))?;
    if !reflection.texture_mapping.is_empty() || reflection.uniforms.len() > 1 {
        return Err("Backgrounds can only use the provided uniforms `u`; textures and other bindings are not available.".into());
    }
    Ok(out)
}

#[command]
pub fn background_compile(wgsl: String) -> Result<String, String> {
    compile(&wgsl)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundItem {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub created_at: u64,
    pub updated_at: u64,
    /// Filled from the `.wgsl` file when listing; not stored in the index.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub wgsl: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundLibrary {
    pub version: u32,
    pub selected: Option<String>,
    pub strength: f32,
    pub animate: bool,
    pub items: Vec<BackgroundItem>,
}

impl Default for BackgroundLibrary {
    fn default() -> Self {
        Self { version: 1, selected: None, strength: 0.35, animate: true, items: Vec::new() }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    id: Option<String>,
    name: String,
    prompt: String,
    wgsl: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Storage in one directory, separated from the command layer for tests.
struct Store { dir: PathBuf }

impl Store {
    fn index(&self) -> PathBuf { self.dir.join("index.json") }
    fn shader(&self, id: &str) -> PathBuf { self.dir.join(format!("{id}.wgsl")) }

    fn read_index(&self) -> BackgroundLibrary {
        fs::read_to_string(self.index()).ok()
            .and_then(|text| serde_json::from_str::<BackgroundLibrary>(&text).ok())
            .unwrap_or_default()
    }

    fn write_index(&self, library: &BackgroundLibrary) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| format!("Could not create the backgrounds folder: {e}"))?;
        let mut stored = library.clone();
        stored.items.iter_mut().for_each(|item| item.wgsl.clear());
        let json = serde_json::to_vec_pretty(&stored).map_err(|e| e.to_string())?;
        crate::storage::write(&self.index(), &json, false).map_err(|e| format!("Could not save backgrounds: {e}"))
    }

    /// Items whose shader file is missing are dropped rather than shown broken.
    fn load(&self) -> BackgroundLibrary {
        let mut library = self.read_index();
        library.items.retain_mut(|item| match fs::read_to_string(self.shader(&item.id)) {
            Ok(wgsl) if valid_id(&item.id) => { item.wgsl = wgsl; true }
            _ => false,
        });
        if library.selected.as_ref().is_some_and(|id| !library.items.iter().any(|item| &item.id == id)) {
            library.selected = None;
        }
        library.strength = library.strength.clamp(0.0, 1.0);
        library
    }

    fn save(&self, request: SaveRequest) -> Result<BackgroundItem, String> {
        let name = request.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err("Give the background a name of up to 80 characters.".into());
        }
        if request.prompt.len() > 4000 {
            return Err("The prompt is too long to store.".into());
        }
        compile(&request.wgsl)?;
        let mut library = self.load();
        let now = now_ms();
        let item = match request.id {
            Some(id) => {
                let existing = library.items.iter_mut().find(|item| item.id == id)
                    .ok_or("No saved background has that ID.")?;
                existing.name = name.to_owned();
                existing.prompt = request.prompt;
                existing.updated_at = now;
                existing.clone()
            }
            None => {
                let mut id = format!("bg-{now}");
                while library.items.iter().any(|item| item.id == id) { id.push('x'); }
                let item = BackgroundItem { id, name: name.to_owned(), prompt: request.prompt, created_at: now, updated_at: now, wgsl: String::new() };
                library.items.push(item.clone());
                item
            }
        };
        fs::create_dir_all(&self.dir).map_err(|e| format!("Could not create the backgrounds folder: {e}"))?;
        crate::storage::write(&self.shader(&item.id), request.wgsl.as_bytes(), false).map_err(|e| format!("Could not save the shader: {e}"))?;
        self.write_index(&library)?;
        Ok(BackgroundItem { wgsl: request.wgsl, ..item })
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        let mut library = self.load();
        let before = library.items.len();
        library.items.retain(|item| item.id != id);
        if library.items.len() == before {
            return Err("No saved background has that ID.".into());
        }
        if library.selected.as_deref() == Some(id) {
            library.selected = None;
        }
        self.write_index(&library)?;
        let _ = fs::remove_file(self.shader(id));
        Ok(())
    }

    fn configure(&self, selected: Option<Option<String>>, strength: Option<f32>, animate: Option<bool>) -> Result<BackgroundLibrary, String> {
        let mut library = self.load();
        if let Some(selected) = selected {
            if selected.as_ref().is_some_and(|id| !library.items.iter().any(|item| &item.id == id)) {
                return Err("No saved background has that ID.".into());
            }
            library.selected = selected;
        }
        if let Some(strength) = strength {
            if !strength.is_finite() { return Err("Strength must be between 0 and 1.".into()); }
            library.strength = strength.clamp(0.0, 1.0);
        }
        if let Some(animate) = animate { library.animate = animate; }
        self.write_index(&library)?;
        Ok(self.load())
    }
}

fn store(app: &AppHandle) -> Result<Store, String> {
    Ok(Store { dir: app.path().app_config_dir().map_err(|e| e.to_string())?.join("backgrounds") })
}

#[command]
pub fn backgrounds_load(app: AppHandle) -> Result<BackgroundLibrary, String> {
    Ok(store(&app)?.load())
}

#[command]
pub fn background_save(app: AppHandle, request: SaveRequest) -> Result<BackgroundItem, String> {
    if request.id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("Invalid background ID.".into());
    }
    store(&app)?.save(request)
}

#[command]
pub fn background_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) { return Err("Invalid background ID.".into()); }
    store(&app)?.delete(&id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureRequest {
    /// Absent leaves the selection alone; `null` turns backgrounds off.
    #[serde(default, deserialize_with = "double_option")]
    selected: Option<Option<String>>,
    strength: Option<f32>,
    animate: Option<bool>,
}

fn double_option<'de, D: serde::Deserializer<'de>>(de: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(de).map(Some)
}

#[command]
pub fn backgrounds_configure(app: AppHandle, request: ConfigureRequest) -> Result<BackgroundLibrary, String> {
    if request.selected.as_ref().and_then(|s| s.as_deref()).is_some_and(|id| !valid_id(id)) {
        return Err("Invalid background ID.".into());
    }
    store(&app)?.configure(request.selected, request.strength, request.animate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const GOOD: &str = "@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {\n  let uv = pos.xy / u.resolution;\n  let w = 0.5 + 0.5 * sin(uv.x * 6.0 + u.time);\n  return mix(u.paper, u.accent, w * u.strength);\n}\n";

    fn temp_store() -> (Store, PathBuf) {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("bustermark-bg-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        (Store { dir: dir.join("backgrounds") }, dir)
    }

    #[test]
    fn compiles_wgsl_to_webgl_glsl_with_the_uniform_block() {
        let glsl = compile(GOOD).unwrap();
        assert!(glsl.starts_with("#version 300 es"));
        assert!(glsl.contains("layout(std140) uniform"));
        assert!(glsl.contains("gl_FragCoord"));
    }

    #[test]
    fn reports_errors_at_the_writers_line_numbers() {
        let error = compile("@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {\n  return vec3f(1.0);\n}\n").unwrap_err();
        assert!(error.contains("wgsl:2:"), "{error}");
        let syntax = compile("@fragment fn fs_main( -> {").unwrap_err();
        assert!(syntax.contains("wgsl:1:"), "{syntax}");
    }

    #[test]
    fn requires_the_entry_point_and_refuses_extra_bindings() {
        assert!(compile("fn helper() -> f32 { return 1.0; }").unwrap_err().contains("fs_main"));
        let texture = "@group(0) @binding(1) var tex: texture_2d<f32>;\n@group(0) @binding(2) var samp: sampler;\n@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f { return textureSample(tex, samp, pos.xy); }";
        assert!(compile(texture).unwrap_err().contains("only use the provided uniforms"));
        assert!(compile("").is_err());
        assert!(compile(&"x".repeat(MAX_SOURCE + 1)).is_err());
    }

    #[test]
    fn saves_lists_updates_selects_and_deletes_backgrounds() {
        let (store, root) = temp_store();
        assert_eq!(store.load(), BackgroundLibrary::default());
        let item = store.save(SaveRequest { id: None, name: " Aurora ".into(), prompt: "slow aurora".into(), wgsl: GOOD.into() }).unwrap();
        assert_eq!(item.name, "Aurora");
        let library = store.configure(Some(Some(item.id.clone())), Some(2.0), Some(false)).unwrap();
        assert_eq!((library.selected.as_deref(), library.strength, library.animate), (Some(item.id.as_str()), 1.0, false));
        assert_eq!(library.items[0].wgsl, GOOD);
        assert!(!fs::read_to_string(store.index()).unwrap().contains("fs_main"), "shader source stays out of the index");
        let updated = store.save(SaveRequest { id: Some(item.id.clone()), name: "Aurora 2".into(), prompt: "p".into(), wgsl: GOOD.replace("6.0", "3.0") }).unwrap();
        assert_eq!(updated.created_at, item.created_at);
        assert!(store.load().items[0].wgsl.contains("3.0"));
        assert!(store.save(SaveRequest { id: None, name: "Broken".into(), prompt: String::new(), wgsl: "nope".into() }).is_err());
        assert_eq!(store.load().items.len(), 1);
        store.delete(&item.id).unwrap();
        let library = store.load();
        assert!(library.items.is_empty() && library.selected.is_none());
        assert!(!store.shader(&item.id).exists());
        assert!(store.delete(&item.id).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn drops_entries_whose_shader_file_is_missing() {
        let (store, root) = temp_store();
        let item = store.save(SaveRequest { id: None, name: "A".into(), prompt: String::new(), wgsl: GOOD.into() }).unwrap();
        store.configure(Some(Some(item.id.clone())), None, None).unwrap();
        fs::remove_file(store.shader(&item.id)).unwrap();
        let library = store.load();
        assert!(library.items.is_empty() && library.selected.is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
