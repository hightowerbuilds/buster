# Sketcher: Brainstorming a DX Spatial Thinking Tool

## 1. Vision
The **Sketcher** is a dedicated tab in Buster designed for "visual thinking." While Buster is a high-performance text editor, developers often need to step back and visualize abstract concepts—system architectures, data flows, UI layouts, or state machines. 

Instead of switching to an external tool like Excalidraw or Miro, Sketcher provides a low-friction, high-performance canvas directly within the IDE, maintaining the "flow" and stylistic consistency of the Buster environment.

## 2. Integration with Buster
- **Tab Type**: A new `sketcher` tab type.
- **Persistence**: Saved as `.sketch` (JSON-based) or exported to `.svg` / `.png`.
- **Styling**: Leverages the current Buster `ThemePalette`. 
    - Lines and shapes use the `accent` and `syntax` colors.
    - Background uses `editorBg` with optional `vignette` and `grain` effects.
    - Supports the "glowing" cursor effect for the active drawing tool.

## 3. Technical Approach

### 3.1. Frontend (SolidJS)
- **Component**: `Sketcher.tsx`
- **Surface**: Uses the existing `CanvasSurface` to handle resizing, input events (mouse/touch/stylus), and canvas context.
- **Rendering**: Directly uses `paintDisplayList` from `src/ui/DisplayListPainter.ts`. This ensures that the rendering logic is identical to how extensions draw, allowing for future "Sketcher Plugins."

### 3.2. State Management
- **Scene Graph**: A reactive list of "Elements" (Strokes, Rects, Circles, Text, Arrows).
- **Undo/Redo**: Simple command-pattern stack.
- **Spatial Index**: For large sketches, a simple grid-based spatial index to optimize hit-testing and culling during render.

### 3.3. Input Handling
- **Tools**:
    - **Pen**: Freehand drawing with pressure sensitivity.
    - **Box/Circle**: Shape primitives with "smart-snapping."
    - **Arrow/Link**: Dynamic connectors that stay attached to shapes (crucial for diagrams).
    - **Text**: Monospace text using Buster's `monoText` renderer.
- **Gestures**: Pan (Middle click / Space + Drag), Zoom (Wheel), Selection (Marquee).

## 4. Libraries vs. Custom Code

| Approach | Pros | Cons |
| :--- | :--- | :--- |
| **Pure Custom** | Zero-dependency, perfect integration with Buster's painter, maximum performance. | More upfront work for basic shapes and text editing. |
| **perfect-freehand** | Beautiful, pressure-sensitive strokes out of the box. | Small dependency, needs integration with our painter. |
| **Rough.js** | Provides that "sketchy," hand-drawn look that fits the brainstorming aesthetic. | Might be too heavy; canvas-only (harder to edit later if not careful). |

**Recommendation**: Start with a **Hybrid Custom** approach. Use `perfect-freehand` for the pen tool logic (generating paths) but render everything through Buster's `DisplayListPainter`. Custom-code the shape and connector logic to ensure they "snap" and "flow" correctly.

## 5. Potential Features for DX
- **Code-to-Sketch**: Drag a function or class from the editor into the Sketcher to create a "card" for it.
- **Sketch-to-Code**: Export a diagram as Mermaid.js or a DSL.
- **Live Collaboration**: (Future) Share a sketch session with other Buster users.
- **Layering**: Toggle between "Logic" layers and "UI" layers.

## 6. Next Steps
1. **Research**: Prototype a basic "Path" recorder in a SolidJS component.
2. **Design**: Define the `.sketch` JSON schema.
3. **Implementation**:
    - Add `"sketcher"` to `TabType` in `src/lib/tab-types.ts`.
    - Create `src/ui/Sketcher.tsx`.
    - Register the panel in `src/lib/panel-definitions.tsx`.
