import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConnectionBanner } from './components/ConnectionBanner';
import { SiteLayout } from './components/SiteLayout';
import { useAuth } from './authStore';
import { MOCK } from './lib/mock';
import { armAudio } from './lib/sound';
import Home from './pages/Home';
import Buzzer from './pages/Buzzer';
import Admin from './pages/Admin';
import Board from './pages/Board';
import Entrar from './pages/Entrar';
import Invitacion from './pages/Invitacion';
import Ligas from './pages/Ligas';
import Liga from './pages/Liga';

export default function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    if (MOCK) {
      // El mock no cubre cuentas: modo anónimo directo, sin pegarle al server.
      useAuth.setState({ status: 'anonymous', user: null, leagues: [] });
      return;
    }
    void init();
  }, [init]);

  // Los browsers exigen un gesto antes de sonar: armamos el AudioContext en el primero.
  useEffect(() => {
    const arm = (): void => armAudio();
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  return (
    <BrowserRouter>
      <ConnectionBanner />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/invitacion/:token" element={<Invitacion />} />
          <Route path="/ligas" element={<Ligas />} />
          <Route path="/liga/:id" element={<Liga />} />
          <Route path="*" element={<Home />} />
        </Route>
        <Route path="/sala/:code" element={<Buzzer />} />
        <Route path="/admin/:code" element={<Admin />} />
        <Route path="/tablero/:code" element={<Board />} />
      </Routes>
    </BrowserRouter>
  );
}
