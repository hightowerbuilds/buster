import "./WelcomeScreen.css";
import WelcomeAscii from "./WelcomeAscii";

export default function WelcomeScreen() {
  return <section class="welcome-screen" aria-label="BusterMark welcome screen">
    <div class="welcome-content">
      <WelcomeAscii />
    </div>
  </section>;
}
