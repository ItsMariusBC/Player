import { AuthGate } from "@/components/auth-gate";
import MusicPlayer from "@/components/player";

export default function App() {
  return (
    <AuthGate>
      <MusicPlayer />
    </AuthGate>
  );
}
