/** Modo mock: `?mock=1` en la URL (persiste en la sesión) o `VITE_MOCK=1`. */
export const MOCK: boolean = (() => {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('mock')) {
      if (params.get('mock') === '0') {
        sessionStorage.removeItem('fanta-mock');
        return false;
      }
      sessionStorage.setItem('fanta-mock', '1');
      return true;
    }
    if (sessionStorage.getItem('fanta-mock') === '1') return true;
  } catch {
    /* sin storage: seguimos */
  }
  try {
    return import.meta.env.VITE_MOCK === '1';
  } catch {
    return false;
  }
})();
