export const THEME_KEY = "invoiceflow-theme";

/**
 * Inline script for <head>: applies the saved (or OS-preferred) theme before first paint,
 * so there is never a flash of the wrong theme.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var d=document.documentElement;d.classList.toggle('dark',t==='dark');d.dataset.theme=t;}catch(e){}})();`;
