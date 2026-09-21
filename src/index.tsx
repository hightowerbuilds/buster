/* @refresh reload */
import { render } from "solid-js/web";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { HotkeysProvider } from "@tanstack/solid-hotkeys";
import "@fontsource/lato/400.css";
import "@fontsource/lato/400-italic.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/700-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/unifrakturmaguntia/400.css";
import App from "./App";
import BusterProvider from "./lib/BusterProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  },
});

// Canvas UI measures text on its first paint. Load the local UI faces before
// mounting so cached widths and hit targets use Lato from the start.
Promise.all([
  document.fonts.load('400 13px "Lato"'),
  document.fonts.load('700 13px "Lato"'),
  document.fonts.load('italic 400 13px "Lato"'),
  document.fonts.load('italic 700 13px "Lato"'),
]).catch(error => console.warn("Unable to load Lato; using the fallback UI font.", error)).then(() => render(
  () => (
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
        <BusterProvider>
          <App />
        </BusterProvider>
      </HotkeysProvider>
    </QueryClientProvider>
  ),
  document.getElementById("root") as HTMLElement
));
