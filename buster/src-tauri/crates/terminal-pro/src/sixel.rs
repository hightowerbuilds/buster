use serde::{Deserialize, Serialize};

/// A decoded sixel image ready for canvas rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SixelImage {
    pub width: u32,
    pub height: u32,
    /// RGBA pixel data (width * height * 4 bytes).
    pub pixels: Vec<u8>,
    /// Terminal row where the image starts.
    pub row: u16,
    /// Terminal column where the image starts.
    pub col: u16,
}

/// Parses sixel graphics sequences from terminal output.
///
/// Sixel format: ESC P <params> q <data> ESC \
/// Each sixel character encodes a 1x6 pixel column.
/// Color registers define the palette.
pub struct SixelParser {
    /// Color palette (register index → [r, g, b]).
    palette: Vec<[u8; 3]>,
}

impl SixelParser {
    pub fn new() -> Self {
        // Initialize with default 256-color palette
        let mut palette = Vec::with_capacity(256);
        for i in 0..256u16 {
            palette.push([
                ((i * 7) % 256) as u8,
                ((i * 13) % 256) as u8,
                ((i * 23) % 256) as u8,
            ]);
        }
        Self { palette }
    }

    /// Check if a byte sequence starts a sixel introduction.
    /// Sixel starts with ESC P (0x1B 0x50) or DCS (0x90).
    pub fn is_sixel_start(data: &[u8]) -> bool {
        if data.len() >= 2 && data[0] == 0x1B && data[1] == 0x50 {
            return true;
        }
        if !data.is_empty() && data[0] == 0x90 {
            return true;
        }
        false
    }

    /// Find the end of a sixel sequence (ESC \ or ST).
    /// Returns the byte offset past the terminator, or None if not found.
    pub fn find_sixel_end(data: &[u8]) -> Option<usize> {
        for i in 0..data.len() {
            // ESC \ (string terminator)
            if data[i] == 0x1B && i + 1 < data.len() && data[i + 1] == 0x5C {
                return Some(i + 2);
            }
            // ST (0x9C)
            if data[i] == 0x9C {
                return Some(i + 1);
            }
        }
        None
    }

    /// Decode a sixel data stream into an image.
    ///
    /// The data should be the content between DCS...q and ST,
    /// not including the DCS introducer or ST terminator.
    pub fn decode(&mut self, data: &[u8], row: u16, col: u16) -> SixelImage {
        let mut width: u32 = 0;
        let mut height: u32 = 6; // minimum sixel height is 6 pixels
        let mut x: u32 = 0;
        let mut y: u32 = 0;
        let mut color_idx: usize = 0;
        let mut max_x: u32 = 0;

        // First pass: determine dimensions
        let mut i = 0;
        while i < data.len() {
            let b = data[i];
            match b {
                // Color introducer: # <register> ; <type> ; <h> ; <s> ; <l>
                b'#' => {
                    i += 1;
                    let (reg, adv) = parse_number(&data[i..]);
                    i += adv;
                    color_idx = reg as usize;

                    // Check if this is a color definition (has semicolons)
                    if i < data.len() && data[i] == b';' {
                        i += 1;
                        let (_ct, adv) = parse_number(&data[i..]);
                        i += adv;
                        if i < data.len() && data[i] == b';' { i += 1; }
                        let (c1, adv) = parse_number(&data[i..]);
                        i += adv;
                        if i < data.len() && data[i] == b';' { i += 1; }
                        let (c2, adv) = parse_number(&data[i..]);
                        i += adv;
                        if i < data.len() && data[i] == b';' { i += 1; }
                        let (c3, adv) = parse_number(&data[i..]);
                        i += adv;

                        // HLS to RGB (simplified — treat as RGB percentages)
                        let r = ((c1 as u32) * 255 / 100).min(255) as u8;
                        let g = ((c2 as u32) * 255 / 100).min(255) as u8;
                        let bl = ((c3 as u32) * 255 / 100).min(255) as u8;

                        while self.palette.len() <= color_idx {
                            self.palette.push([0, 0, 0]);
                        }
                        self.palette[color_idx] = [r, g, bl];
                    }
                }
                // Carriage return: go back to start of current sixel row
                b'$' => {
                    x = 0;
                    i += 1;
                }
                // New line: move down 6 pixels
                b'-' => {
                    x = 0;
                    y += 6;
                    height = height.max(y + 6);
                    i += 1;
                }
                // Repeat introducer: ! <count> <sixel_char>
                b'!' => {
                    i += 1;
                    let (count, adv) = parse_number(&data[i..]);
                    i += adv;
                    if i < data.len() && data[i] >= 0x3F && data[i] <= 0x7E {
                        x += count;
                        max_x = max_x.max(x);
                        i += 1;
                    }
                }
                // Sixel data character (0x3F to 0x7E)
                0x3F..=0x7E => {
                    x += 1;
                    max_x = max_x.max(x);
                    i += 1;
                }
                _ => {
                    i += 1;
                }
            }
        }

        width = max_x;
        if width == 0 || height == 0 {
            return SixelImage {
                width: 0,
                height: 0,
                pixels: Vec::new(),
                row,
                col,
            };
        }

        // Second pass: render pixels
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        x = 0;
        y = 0;
        color_idx = 0;
        i = 0;

        while i < data.len() {
            let b = data[i];
            match b {
                b'#' => {
                    i += 1;
                    let (reg, adv) = parse_number(&data[i..]);
                    i += adv;
                    color_idx = reg as usize;
                    // Skip color definition params
                    if i < data.len() && data[i] == b';' {
                        while i < data.len() && data[i] != b'#' && data[i] != b'$'
                            && data[i] != b'-' && !(data[i] >= 0x3F && data[i] <= 0x7E)
                            && data[i] != b'!'
                        {
                            i += 1;
                        }
                    }
                }
                b'$' => { x = 0; i += 1; }
                b'-' => { x = 0; y += 6; i += 1; }
                b'!' => {
                    i += 1;
                    let (count, adv) = parse_number(&data[i..]);
                    i += adv;
                    if i < data.len() && data[i] >= 0x3F && data[i] <= 0x7E {
                        let sixel = data[i] - 0x3F;
                        let color = self.palette.get(color_idx).copied().unwrap_or([255, 255, 255]);
                        for _ in 0..count {
                            render_sixel(&mut pixels, width, height, x, y, sixel, color);
                            x += 1;
                        }
                        i += 1;
                    }
                }
                0x3F..=0x7E => {
                    let sixel = b - 0x3F;
                    let color = self.palette.get(color_idx).copied().unwrap_or([255, 255, 255]);
                    render_sixel(&mut pixels, width, height, x, y, sixel, color);
                    x += 1;
                    i += 1;
                }
                _ => { i += 1; }
            }
        }

        SixelImage {
            width,
            height,
            pixels,
            row,
            col,
        }
    }
}

impl Default for SixelParser {
    fn default() -> Self {
        Self::new()
    }
}

/// Render a single sixel character (6 vertical pixels) into the pixel buffer.
fn render_sixel(pixels: &mut [u8], width: u32, height: u32, x: u32, y: u32, sixel: u8, color: [u8; 3]) {
    for bit in 0..6u32 {
        if sixel & (1 << bit) != 0 {
            let py = y + bit;
            if x < width && py < height {
                let offset = ((py * width + x) * 4) as usize;
                if offset + 3 < pixels.len() {
                    pixels[offset] = color[0];
                    pixels[offset + 1] = color[1];
                    pixels[offset + 2] = color[2];
                    pixels[offset + 3] = 255; // alpha
                }
            }
        }
    }
}

/// Parse a decimal number from the start of a byte slice.
/// Returns (value, bytes_consumed).
fn parse_number(data: &[u8]) -> (u32, usize) {
    let mut val: u32 = 0;
    let mut i = 0;
    while i < data.len() && data[i].is_ascii_digit() {
        val = val * 10 + (data[i] - b'0') as u32;
        i += 1;
    }
    (val, i)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sixel_start_detection() {
        assert!(SixelParser::is_sixel_start(&[0x1B, 0x50]));
        assert!(SixelParser::is_sixel_start(&[0x90]));
        assert!(!SixelParser::is_sixel_start(&[0x1B, 0x5B])); // CSI, not DCS
        assert!(!SixelParser::is_sixel_start(&[b'A']));
    }

    #[test]
    fn test_sixel_end_detection() {
        let data = [b'x', b'y', 0x1B, 0x5C, b'z'];
        assert_eq!(SixelParser::find_sixel_end(&data), Some(4));

        let data2 = [b'x', 0x9C, b'z'];
        assert_eq!(SixelParser::find_sixel_end(&data2), Some(2));

        let data3 = [b'x', b'y', b'z'];
        assert_eq!(SixelParser::find_sixel_end(&data3), None);
    }

    #[test]
    fn test_empty_sixel() {
        let mut parser = SixelParser::new();
        let img = parser.decode(&[], 0, 0);
        assert_eq!(img.width, 0);
        assert_eq!(img.height, 0);
    }

    #[test]
    fn test_single_sixel_char() {
        let mut parser = SixelParser::new();
        // Sixel char '?' (0x3F) = value 0 (no bits set)
        // Sixel char '@' (0x40) = value 1 (bottom bit set)
        let data = [0x40]; // one pixel column, bottom bit
        let img = parser.decode(&data, 0, 0);
        assert_eq!(img.width, 1);
        assert_eq!(img.height, 6);
        // First pixel (y=0) should be set
        assert_eq!(img.pixels[3], 255); // alpha = 255
    }

    #[test]
    fn test_sixel_newline() {
        let mut parser = SixelParser::new();
        // Two rows: one char, newline, one char
        let data = [0x40, b'-', 0x40];
        let img = parser.decode(&data, 5, 10);
        assert_eq!(img.width, 1);
        assert_eq!(img.height, 12); // 2 sixel rows = 12 pixels
        assert_eq!(img.row, 5);
        assert_eq!(img.col, 10);
    }

    #[test]
    fn test_sixel_repeat() {
        let mut parser = SixelParser::new();
        // Repeat '~' (all bits set) 5 times
        let data = [b'!', b'5', 0x7E];
        let img = parser.decode(&data, 0, 0);
        assert_eq!(img.width, 5);
    }
}
