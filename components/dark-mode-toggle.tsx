// components/dark-mode-toggle.tsx
import { useState, useEffect } from 'react';
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";
import { motion } from "framer-motion";

type ColorMode = 'light' | 'dark' | 'system';

export function DarkModeToggle() {
  const [colorMode, setColorMode] = useState<ColorMode>('system');
  const [isDark, setIsDark] = useState(false);
  
  // Effet d'initialisation
  useEffect(() => {
    // Récupérer le mode de couleur préféré depuis localStorage
    const savedColorMode = localStorage.getItem('color-mode') as ColorMode || 'system';
    setColorMode(savedColorMode);
    
    // Appliquer le mode de couleur initial
    applyColorMode(savedColorMode);
    
    // Configurer le détecteur de préférence du système
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (savedColorMode === 'system') {
        applyDarkMode(mediaQuery.matches);
      }
    };
    
    // Configurer le gestionnaire d'événements
    mediaQuery.addEventListener('change', handleChange);
    
    // Nettoyer
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  
  // Appliquer le mode de couleur
  const applyColorMode = (mode: ColorMode) => {
    // Déterminer si le mode sombre doit être activé
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = mode === 'dark' || (mode === 'system' && prefersDark);
    
    // Appliquer le mode sombre si nécessaire
    applyDarkMode(shouldBeDark);
    
    // Sauvegarder le mode de couleur
    localStorage.setItem('color-mode', mode);
  };
  
  // Appliquer le mode sombre
  const applyDarkMode = (dark: boolean) => {
    // Mettre à jour l'état
    setIsDark(dark);
    
    // Appliquer la classe au document
    if (dark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
  };
  
  // Changer le mode de couleur
  const toggleColorMode = () => {
    const modes: ColorMode[] = ['light', 'dark', 'system'];
    const currentIndex = modes.indexOf(colorMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    
    setColorMode(nextMode);
    applyColorMode(nextMode);
  };
  
  return (
    <button
      onClick={toggleColorMode}
      className={cn(
        buttonVariants({
          variant: "secondary",
        }),
      )}
      aria-label="Changer le mode de couleur"
    >
      {/* Icône mode clair */}
      <motion.div
        animate={{ 
          opacity: colorMode === 'light' ? 1 : 0,
          scale: colorMode === 'light' ? 1 : 0,
          rotate: colorMode === 'light' ? 0 : 180
        }}
        transition={{ duration: 0.3 }}
        style={{ position: colorMode === 'light' ? 'relative' : 'absolute' }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </motion.div>
      
      {/* Icône mode sombre */}
      <motion.div
        animate={{ 
          opacity: colorMode === 'dark' ? 1 : 0,
          scale: colorMode === 'dark' ? 1 : 0,
          rotate: colorMode === 'dark' ? 0 : -180
        }}
        transition={{ duration: 0.3 }}
        style={{ position: colorMode === 'dark' ? 'relative' : 'absolute' }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </motion.div>
      
      {/* Icône mode système */}
      <motion.div
        animate={{ 
          opacity: colorMode === 'system' ? 1 : 0,
          scale: colorMode === 'system' ? 1 : 0,
          rotate: colorMode === 'system' ? 0 : 180
        }}
        transition={{ duration: 0.3 }}
        style={{ position: colorMode === 'system' ? 'relative' : 'absolute' }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </motion.div>
      
      <span className="ml-2">
        {colorMode === 'light' ? 'Clair' : colorMode === 'dark' ? 'Sombre' : 'Auto'}
      </span>
    </button>
  );
}

// Mise à jour du fichier globals.css pour supporter le mode sombre
// Ajoutez ceci à la fin de votre fichier src/globals.css :
/*
@layer base {
  :root {
    --background: 280 50% 95%;
    --foreground: 280 10% 10%;
    --primary: 280 80% 50%;
    --primary-foreground: 280 10% 98%;
    --secondary: 280 30% 90%;
    --secondary-foreground: 280 10% 10%;
    --accent: 280 80% 50%;
    --accent-foreground: 280 10% 98%;
    --border: 280 20% 80%;
    --ring: 280 80% 50%;
  }

  .dark {
    --background: 280 30% 10%;
    --foreground: 280 10% 98%;
    --primary: 280 80% 50%;
    --primary-foreground: 280 10% 98%;
    --secondary: 280 30% 20%;
    --secondary-foreground: 280 10% 98%;
    --accent: 280 80% 40%;
    --accent-foreground: 280 10% 98%;
    --border: 280 20% 30%;
    --ring: 280 80% 50%;
  }
}

/* Appliquer les couleurs du thème */
/*
@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
*/
