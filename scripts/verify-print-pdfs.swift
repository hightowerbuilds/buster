// Read-only companion to native-macos-print-smoke.js. No printer jobs.
import Foundation
import PDFKit

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}
require(CommandLine.arguments.count == 2, "Pass the isolated Notes directory")
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
func document(_ name: String) -> PDFDocument {
    let url = root.appendingPathComponent(name + ".pdf")
    guard let pdf = PDFDocument(url: url) else { fputs("Cannot open \(url.path)\n", stderr); exit(1) }
    require(pdf.pageCount > 0, "\(name) has pages")
    return pdf
}
let portrait = document("portrait-all")
let range = document("portrait-page-two")
let landscape = document("landscape-a4")
let bounds = portrait.page(at: 0)!.bounds(for: .mediaBox)
require(abs(bounds.width - 612) < 1 && abs(bounds.height - 792) < 1, "Letter portrait dimensions")
let landscapeBounds = landscape.page(at: 0)!.bounds(for: .mediaBox)
require(abs(landscapeBounds.width - 841.89) < 1 && abs(landscapeBounds.height - 595.276) < 1, "A4 landscape dimensions")
require(portrait.pageCount > 2 && landscape.pageCount > 2, "Long draft paginates")
require(range.pageCount == 1, "Page range exports only one page")
func normalize(_ text: String) -> String { text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
require(normalize(range.string ?? "") == normalize(portrait.page(at: 1)?.string ?? ""), "Range is exactly original page two")
for (name, pdf) in [("portrait", portrait), ("landscape", landscape)] {
    let text = normalize(pdf.string ?? "")
    require(text.contains("Print acceptance") && text.contains("café") && text.contains("déjà vu"), "\(name) preserves Unicode text")
    require(text.contains("Paragraph 001:") && text.contains("Paragraph 100:") && text.contains("PRINT END MARKER"), "\(name) includes complete draft")
    require(!text.contains("Requested by the Language Model") && !text.contains("Save PDF…") && !text.contains("Single View"), "\(name) excludes application UI")
}
print("PASS: Letter portrait \(portrait.pageCount) pages; page-two range 1 page; A4 landscape \(landscape.pageCount) pages; Unicode draft, dimensions and page selection verified.")
