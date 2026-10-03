use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use serde::Serialize;

static NEXT_SURFACE_ID: AtomicU32 = AtomicU32::new(1);
static NEXT_MEASURE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceEvent {
    pub surface_id: u32,
    pub extension_id: String,
    pub kind: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeasureTextRequest {
    pub request_id: u64,
    pub text: String,
    pub font: String,
}

#[derive(Debug, Clone)]
pub struct TextMetrics {
    pub width: f64,
    pub height: f64,
    pub ascent: f64,
    pub descent: f64,
}

#[derive(Debug, Clone)]
struct SurfaceRecord {
    extension_id: String,
    width: u32,
    height: u32,
    label: String,
    /// Last display list JSON — buffered so late-mounting frontends can fetch it
    last_paint: Option<String>,
}

type EventSink<T> = Mutex<Option<Arc<dyn Fn(T) + Send + Sync>>>;

pub struct SurfaceManager {
    surfaces: Mutex<HashMap<u32, SurfaceRecord>>,
    pending_measures: Mutex<HashMap<u64, mpsc::Sender<TextMetrics>>>,
    event_sink: EventSink<SurfaceEvent>,
    measure_sink: EventSink<MeasureTextRequest>,
}

impl SurfaceManager {
    pub fn new() -> Self {
        Self {
            surfaces: Mutex::new(HashMap::new()),
            pending_measures: Mutex::new(HashMap::new()),
            event_sink: Mutex::new(None),
            measure_sink: Mutex::new(None),
        }
    }

    pub fn set_event_sink(&self, sink: Arc<dyn Fn(SurfaceEvent) + Send + Sync>) {
        *self.event_sink.lock().unwrap() = Some(sink);
    }

    pub fn set_measure_sink(&self, sink: Arc<dyn Fn(MeasureTextRequest) + Send + Sync>) {
        *self.measure_sink.lock().unwrap() = Some(sink);
    }

    fn emit(&self, event: SurfaceEvent) {
        if let Some(sink) = self.event_sink.lock().unwrap().as_ref() {
            sink(event);
        }
    }

    pub fn request_surface(&self, extension_id: &str, width: u32, height: u32, label: &str) -> u32 {
        let id = NEXT_SURFACE_ID.fetch_add(1, Ordering::Relaxed);
        let record = SurfaceRecord {
            extension_id: extension_id.to_string(),
            width,
            height,
            label: label.to_string(),
            last_paint: None,
        };
        self.surfaces.lock().unwrap().insert(id, record);

        let content = serde_json::json!({
            "width": width,
            "height": height,
            "label": label,
        }).to_string();

        self.emit(SurfaceEvent {
            surface_id: id,
            extension_id: extension_id.to_string(),
            kind: "created".to_string(),
            content,
        });

        id
    }

    pub fn paint(&self, surface_id: u32, display_list_json: &str) -> Result<(), String> {
        let mut surfaces = self.surfaces.lock().unwrap();
        let record = surfaces.get_mut(&surface_id)
            .ok_or_else(|| format!("Surface {} not found", surface_id))?;
        record.last_paint = Some(display_list_json.to_string());
        let ext_id = record.extension_id.clone();
        drop(surfaces);

        self.emit(SurfaceEvent {
            surface_id,
            extension_id: ext_id,
            kind: "paint".to_string(),
            content: display_list_json.to_string(),
        });

        Ok(())
    }

    /// Get the last paint content for a surface (for late-mounting frontends).
    pub fn get_last_paint(&self, surface_id: u32) -> Option<String> {
        let surfaces = self.surfaces.lock().unwrap();
        surfaces.get(&surface_id).and_then(|r| r.last_paint.clone())
    }

    pub fn resize_surface(&self, surface_id: u32, width: u32, height: u32) -> Result<(), String> {
        let mut surfaces = self.surfaces.lock().unwrap();
        let record = surfaces.get_mut(&surface_id)
            .ok_or_else(|| format!("Surface {} not found", surface_id))?;
        record.width = width;
        record.height = height;
        let ext_id = record.extension_id.clone();
        drop(surfaces);

        let content = serde_json::json!({ "width": width, "height": height }).to_string();
        self.emit(SurfaceEvent {
            surface_id,
            extension_id: ext_id,
            kind: "resize".to_string(),
            content,
        });

        Ok(())
    }

    pub fn release_surface(&self, surface_id: u32) -> Result<(), String> {
        let record = self.surfaces.lock().unwrap().remove(&surface_id)
            .ok_or_else(|| format!("Surface {} not found", surface_id))?;

        self.emit(SurfaceEvent {
            surface_id,
            extension_id: record.extension_id,
            kind: "released".to_string(),
            content: String::new(),
        });

        Ok(())
    }

    pub fn release_all_for_extension(&self, extension_id: &str) {
        let ids: Vec<u32> = {
            let surfaces = self.surfaces.lock().unwrap();
            surfaces.iter()
                .filter(|(_, r)| r.extension_id == extension_id)
                .map(|(id, _)| *id)
                .collect()
        };
        for id in ids {
            let _ = self.release_surface(id);
        }
    }

    /// Create a measurement request. Returns a receiver that will get the metrics
    /// when the frontend responds.
    pub fn request_measure(&self, text: &str, font: &str) -> (u64, mpsc::Receiver<TextMetrics>) {
        let id = NEXT_MEASURE_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending_measures.lock().unwrap().insert(id, tx);

        if let Some(sink) = self.measure_sink.lock().unwrap().as_ref() {
            sink(MeasureTextRequest {
                request_id: id,
                text: text.to_string(),
                font: font.to_string(),
            });
        }

        (id, rx)
    }

    /// Resolve a pending text measurement (called from the Tauri command handler).
    pub fn resolve_measure(&self, request_id: u64, metrics: TextMetrics) {
        if let Some(tx) = self.pending_measures.lock().unwrap().remove(&request_id) {
            let _ = tx.send(metrics);
        }
    }
}
