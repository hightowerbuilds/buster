# Buster Sketch Feature: Implementation Plan

## 1. Executive Summary

The goal of this initiative is to introduce a native, high-performance sketching feature into the Buster editor. This feature will act as a built-in "MS Paint-like" utility, allowing developers to visually brainstorm, map out architectures, and doodle abstract thoughts directly within their IDE workspace. Crucially, this will not rely on heavy third-party canvas libraries for the core drawing mechanics; instead, we will build a custom infinite canvas implementation tailored to Buster's existing high-performance rendering philosophy. For text rendering within the sketch environment, we will integrate `Pretext.js`, combining our custom drawing logic with robust text capabilities. The sketch will persist across sessions until explicitly cleared by the developer, ensuring that long-term architectural diagrams or ongoing brainstorms are preserved. Access to the sketching environment will be seamlessly integrated via the CommandLineSwitchboard.

## 2. Core Requirements & Constraints

*   **Custom Infinite Canvas:** The core drawing engine must be built in-house without relying on libraries like Fabric.js, Konva, or Paper.js. This ensures tight integration with Buster's existing WebGL/Canvas rendering pipeline (e.g., `canvas-renderer.ts`, `DisplayListPainter.ts`).
*   **Pretext.js Integration:** `Pretext.js` will be specifically utilized to handle the complexities of text rendering, layout, and editing within the canvas environment.
*   **Persistence:** Sketch data must be serialized and persisted across application restarts. The data will remain until the user executes a "Clear Sketch" command.
*   **Command Line Switchboard Integration:** The sketch mode must be easily toggled via the `CommandLineSwitchboard.tsx`, treating it as a primary workspace view alongside the editor and terminal.
*   **Performance:** Given the infinite nature of the canvas, the rendering loop must be optimized for 60fps, utilizing spatial hashing or quad-trees for efficient culling of off-screen strokes.
*   **MS Paint-like Simplicity:** The toolset should be intuitive and immediate: Pen, Eraser, Line, Rectangle, Ellipse, Text (via Pretext.js), and basic color selection.

## 3. Architectural Design

The architecture of the Sketch feature will be broken down into several distinct layers: State Management, the Rendering Engine (Canvas & Math), the Tooling System, Input Handling, and the UI/Integration layer.

### 3.1 State Management & Data Structures

To support an infinite canvas and robust persistence, the state must be modeled as a collection of vector graphics rather than a raster image.

*   **Stroke Definition:** A freehand stroke will be represented as an array of points (x, y, pressure), along with styling properties (color, thickness).
*   **Shape Definition:** Geometric shapes (lines, rectangles, ellipses) will be defined by their bounding coordinates and style properties.
*   **Text Node Definition:** Text elements managed by Pretext.js will require storing the string content, font properties, position, and bounding box.
*   **The Scene Graph:** The overall state will be a flat array (or spatially optimized structure) of these rendering primitives.
*   **Camera State:** To navigate the infinite canvas, we must maintain a Camera object containing `x`, `y` (translation), and `zoom` (scale) properties.

### 3.2 The Infinite Canvas Math

An infinite canvas requires a coordinate system transformation between "Screen Space" (the physical pixels on the monitor) and "World Space" (the infinite logical canvas).

*   **World to Screen Transformation:**
    ```typescript
    screenX = (worldX - camera.x) * camera.zoom
    screenY = (worldY - camera.y) * camera.zoom
    ```
*   **Screen to World Transformation (Crucial for Input):**
    ```typescript
    worldX = (screenX / camera.zoom) + camera.x
    worldY = (screenY / camera.zoom) + camera.y
    ```
Panning the canvas will involve updating `camera.x` and `camera.y` based on mouse drag deltas (in screen space converted to world space). Zooming will update `camera.zoom` while maintaining the world position under the mouse cursor as the origin of the scale.

### 3.3 Rendering Pipeline

The rendering engine will piggyback on Buster's existing architectural patterns, likely utilizing a standard HTML5 `<canvas>` optimized with `requestAnimationFrame`.

1.  **Clear the Canvas:** On every frame that requires an update, the canvas is cleared.
2.  **Apply Camera Transform:** The canvas 2D context will have `ctx.translate()` and `ctx.scale()` applied based on the Camera State.
3.  **Culling (Optimization):** Before drawing, we calculate the visible bounding box of the world based on the screen dimensions and camera state. We iterate through the Scene Graph and only issue draw calls for elements that intersect with this visible bounding box.
4.  **Drawing Primitives:**
    *   Iterate through Strokes, applying `ctx.beginPath()`, `ctx.moveTo()`, `ctx.lineTo()`, and `ctx.stroke()`.
    *   Iterate through Shapes.
5.  **Pretext.js Rendering:** Pretext.js will be invoked to render the text nodes at their respective world coordinates.

### 3.4 Tooling System & Input Handling

A state machine will govern the current active tool (Pan, Pen, Eraser, Shape, Text). Input events (pointerdown, pointermove, pointerup, wheel) will be intercepted and routed to the active tool.

*   **Pen Tool:** On `pointerdown`, initialize a new Stroke. On `pointermove`, push new points to the Stroke array. On `pointerup`, finalize the stroke. Smooth the stroke using Bezier curve fitting for a polished look.
*   **Pan Tool (Spacebar + Drag):** On `pointermove`, update the Camera translation.
*   **Eraser Tool:** Implemented either as a stroke that draws with `globalCompositeOperation = 'destination-out'` (raster approach, less ideal for infinite vector canvas) or by performing intersection tests to delete strokes from the Scene Graph (vector approach, preferred).
*   **Text Tool:** On click, instantiate a Pretext.js editing surface overlayed on the canvas. On blur, commit the Pretext.js data into the Scene Graph.

## 4. Pretext.js Integration Strategy

`Pretext.js` is specified as the library for handling text. Integrating a DOM-based or specialized text library into a custom infinite canvas requires careful synchronization.

1.  **Editing State:** When a user clicks to add text, we position a hidden or overlay DOM element managed by Pretext.js directly over the canvas, matching the world-to-screen transform so it appears in place.
2.  **Commit State:** Once editing is complete (e.g., clicking away), the Pretext.js state is serialized and stored in our Scene Graph.
3.  **Render State:** During the standard canvas render loop, we query Pretext.js to draw the text content onto the canvas context, applying the necessary camera scaling and translation. If Pretext.js relies on DOM nodes for rendering, we must implement a synchronization layer that updates the CSS `transform` (translate and scale) of these DOM nodes to match the canvas camera perfectly, ensuring text scales and pans seamlessly with the hand-drawn strokes.

## 5. Persistence and Storage

To ensure the sketch persists until the developer clears it, we will utilize local storage mechanisms available within the Tauri environment (likely writing to the local filesystem via Tauri's FS API, or IndexedDB if constrained to the web view).

*   **Serialization:** The Scene Graph must be serializable to JSON.
*   **Save Triggers:** To avoid performance hits, saving should be debounced (e.g., save 1 second after the last modification) rather than on every frame or stroke point.
*   **Load on Boot:** When the Sketch view is initialized, it will attempt to read the serialized state from disk. If found, it deserializes and populates the Scene Graph and Camera State.
*   **Clear Command:** A dedicated command (accessible via Command Palette or a UI button in the sketch view) will clear the Scene Graph and delete the persisted file.

## 6. Buster UI Integration

The Sketch feature must feel like a native part of the Buster IDE.

### 6.1 CommandLineSwitchboard

The `CommandLineSwitchboard.tsx` currently acts as a central router for different modes or commands. We will add a new command (e.g., `sketch` or `brainstorm`) that triggers a state change in the `BusterProvider`.

### 6.2 View Layout

When activated, the main editor surface (or a new dedicated tab/panel) will swap to `SketchSurface.tsx`.

*   **SketchSurface.tsx:** The primary React component hosting the `<canvas>` element. It will manage the ResizeObserver to keep the canvas resolution synced with the container size.
*   **SketchToolbar.tsx:** A floating or docked toolbar providing tool selection (Pen, Text, Shapes), color picker, and stroke width slider. This should utilize existing Buster UI components (e.g., from `src/styles/command-line.css` or generic button styles) for visual consistency.

## 7. Step-by-Step Implementation Plan

### Phase 1: Foundation and Math
1.  Create `src/sketch/` directory to house the feature.
2.  Implement `camera.ts` to handle World <-> Screen coordinate transformations.
3.  Implement `scene.ts` to define the data structures (Strokes, Shapes) and the Scene Graph array.
4.  Create the basic `SketchSurface.tsx` component with an HTML5 `<canvas>` and a fundamental render loop (`requestAnimationFrame`) that clears the screen and draws a grid based on camera coordinates to verify panning and zooming.

### Phase 2: Drawing and Input
1.  Implement an input routing system to capture pointer events on the canvas.
2.  Implement the `PenTool` to capture points and draw them to the canvas via the Scene Graph.
3.  Implement basic bezier curve smoothing for the strokes.
4.  Implement panning (middle mouse drag or spacebar + drag) and zooming (mouse wheel).

### Phase 3: Pretext.js and Tooling
1.  Integrate `Pretext.js`. Create the synchronization layer to handle text input overlay and canvas rendering/DOM positioning based on the camera state.
2.  Implement the `TextTool` to trigger Pretext.js.
3.  Add basic shape tools (Line, Rectangle).
4.  Build the `SketchToolbar.tsx` UI and connect it to the active tool state.

### Phase 4: Integration and Persistence
1.  Wire the Sketch view into `CommandLineSwitchboard.tsx` and the main layout system.
2.  Implement the serialization/deserialization logic for the Scene Graph.
3.  Implement the debounced save-to-disk logic using Tauri's filesystem APIs (or `localStorage` as a fallback).
4.  Add the "Clear Sketch" command to the Command Registry.

### Phase 5: Polish and Optimization
1.  Implement spatial hashing or simple bounding-box culling in the render loop to ensure 60fps even with thousands of strokes on the infinite canvas.
2.  Refine the look and feel of the strokes (e.g., implementing pressure sensitivity if supported by the device).
3.  Ensure styling matches the overall Buster aesthetic (colors, fonts, toolbar design).
4.  Write comprehensive tests for the coordinate math and serialization logic.

## 8. Potential Risks and Mitigations

*   **Performance Bottlenecks:** Rendering thousands of vector strokes on a 2D canvas can be slow. *Mitigation:* Aggressive culling of off-screen elements. If 2D canvas is too slow, we may need to migrate the sketch rendering to utilize the existing `webgl-text.ts` or `canvas-renderer.ts` WebGL pipelines, converting strokes to polygon meshes.
*   **Pretext.js DOM vs Canvas Mismatch:** Syncing DOM elements with a hardware-accelerated, zoomable canvas can lead to jitter or 1px misalignments. *Mitigation:* Ensure `transform-origin: top left` is used on DOM elements and carefully sync the floating-point camera scale to the CSS `matrix()` or `scale()` properties.
*   **Large File Sizes:** A complex sketch can generate a large JSON file. *Mitigation:* Implement basic compression (e.g., storing stroke points as delta-encoded arrays or using a binary format) if save/load times become noticeable.

## 9. Conclusion

This custom MS Paint-like feature will significantly enhance the developer experience within Buster, providing a seamless workflow between abstract brainstorming and concrete code implementation. By building the core engine in-house, we maintain strict control over performance and integration, ensuring the infinite canvas feels as fast and responsive as the core text editor. The strategic use of Pretext.js solves the historically difficult problem of canvas text editing, allowing us to deliver a robust feature in a timely manner.

## 10. Extended Details for Completeness (1000+ words target)

To further elaborate on the specific details of the infinite canvas implementation: 
When dealing with infinite coordinates, floating-point precision issues can arise at extreme distances from the origin (0,0). To handle this gracefully without re-centering the coordinate space, the camera matrix translation must be applied cleanly via 64-bit precision where possible. 

In terms of the serialization layer, integrating with Tauri offers us robust desktop application features. We will define a `.buster-sketch` binary or JSON format. Given the potential size of uncompressed JSON for thousands of freehand strokes, employing something like BSON or simply Gzipping the JSON payload via a Rust-side Tauri command will significantly reduce overhead during auto-saves. 

On the UI front, the integration with `CommandLineSwitchboard.tsx` is paramount. The switchboard currently listens to user commands; typing "sketch" or hitting a specific keybinding (e.g., `Cmd+Shift+K`) should transition the primary view. The layout transition must be animated fluidly to match the overall polish of Buster. The sketching view itself should minimize extraneous UI elements to maximize the "infinite" feel of the canvas, perhaps autohiding the toolbar when not actively mousing over its boundary. 

Additionally, consideration must be made for touch and pen input support, as these are critical for an authentic sketching experience. Web Pointer Events API provides `pressure` and `tiltX/tiltY` attributes. Our freehand stroke rendering logic should consume these parameters to modulate the stroke width and opacity dynamically. This elevates the feature from a basic charting tool to a genuinely expressive sketching environment suitable for visual thinkers.

Testing this feature will require a multi-tiered approach. Unit tests will cover the mathematical transformations in `camera.ts` and the data integrity in `scene.ts`. Integration testing will involve simulating pointer events on the `SketchSurface.tsx` component to verify that strokes are correctly mapped from screen to world coordinates and appended to the scene graph. Finally, visual regression testing, perhaps using Playwright or Puppeteer hooked into the Tauri webview, will ensure that the canvas rendering (including Pretext.js overlays) remains pixel-perfect across updates to Buster.

This comprehensive plan provides a clear, actionable roadmap for integrating this complex but highly valuable feature into the Buster ecosystem while adhering to the user's specific constraints and requirements.
