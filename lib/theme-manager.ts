// lib/theme-manager.ts
export type ColorTheme = {
    id: string;
    name: string;
    primary: string;
    secondary: string;
    background: string;
    text: string;
    gradient: [string, string, string];
  };
  
  export const DEFAULT_THEMES: ColorTheme[] = [
    {
      id: 'purple',
      name: 'Purple Haze',
      primary: '#8d7dca',
      secondary: '#606080',
      background: '#13041f',
      text: '#e0ccff',
      gradient: ['#606080', '#8d7dca', '#212121']
    },
    {
      id: 'ocean',
      name: 'Ocean Breeze',
      primary: '#00298a',
      secondary: '#80ffc3',
      background: '#0a192f',
      text: '#80ffc3',
      gradient: ['#80ffc3', '#a6574e', '#00298a']
    },
    {
      id: 'sunset',
      name: 'Sunset Glow',
      primary: '#f57ff3',
      secondary: '#58426e',
      background: '#210c1c',
      text: '#f8e3ff',
      gradient: ['#f57ff3', '#58426e', '#210c1c']
    },
    {
      id: 'midnight',
      name: 'Midnight Bliss',
      primary: '#00b4d8',
      secondary: '#023e8a',
      background: '#03045e',
      text: '#caf0f8',
      gradient: ['#00b4d8', '#023e8a', '#03045e']
    },
    {
      id: 'forest',
      name: 'Forest Calm',
      primary: '#40916c',
      secondary: '#2d6a4f',
      background: '#081c15',
      text: '#d8f3dc',
      gradient: ['#40916c', '#2d6a4f', '#081c15']
    }
  ];
  
  export interface ThemeManagerOptions {
    onThemeChange?: (theme: ColorTheme) => void;
  }
  
  export interface ThemeManager {
    availableThemes: ColorTheme[];
    currentTheme: ColorTheme;
    
    setTheme(themeId: string): void;
    getTheme(): ColorTheme;
    addCustomTheme(theme: Omit<ColorTheme, 'id'>): ColorTheme;
    removeCustomTheme(themeId: string): void;
  }
  
  export function createThemeManager(options?: ThemeManagerOptions): ThemeManager {
    // Get custom themes from localStorage
    const getCustomThemes = (): ColorTheme[] => {
      const customThemesJSON = localStorage.getItem('custom_themes');
      if (customThemesJSON) {
        return JSON.parse(customThemesJSON);
      }
      return [];
    };
    
    // Save custom themes to localStorage
    const saveCustomThemes = (themes: ColorTheme[]) => {
      localStorage.setItem('custom_themes', JSON.stringify(themes));
    };
    
    // Get current theme ID from localStorage
    const getCurrentThemeId = (): string => {
      const themeId = localStorage.getItem('current_theme');
      return themeId || 'purple'; // Default to purple theme
    };
    
    // Save current theme ID to localStorage
    const saveCurrentThemeId = (themeId: string) => {
      localStorage.setItem('current_theme', themeId);
    };
    
    // Get all themes (default + custom)
    const getAllThemes = (): ColorTheme[] => {
      return [...DEFAULT_THEMES, ...getCustomThemes()];
    };
    
    // Find theme by ID
    const findThemeById = (themeId: string): ColorTheme => {
      const allThemes = getAllThemes();
      return allThemes.find(t => t.id === themeId) || DEFAULT_THEMES[0];
    };
    
    // Apply theme to document
    const applyTheme = (theme: ColorTheme) => {
      document.documentElement.style.setProperty('--color-primary', theme.primary);
      document.documentElement.style.setProperty('--color-secondary', theme.secondary);
      document.documentElement.style.setProperty('--color-background', theme.background);
      document.documentElement.style.setProperty('--color-text', theme.text);
      
      // Apply background color to body
      document.body.style.backgroundColor = theme.background;
      document.body.style.color = theme.text;
      
      options?.onThemeChange?.(theme);
    };
    
    // Initialize theme on load
    const initialTheme = findThemeById(getCurrentThemeId());
    applyTheme(initialTheme);
    
    return {
      availableThemes: getAllThemes(),
      currentTheme: initialTheme,
      
      setTheme(themeId: string): void {
        const theme = findThemeById(themeId);
        applyTheme(theme);
        saveCurrentThemeId(themeId);
        this.currentTheme = theme;
      },
      
      getTheme(): ColorTheme {
        return this.currentTheme;
      },
      
      addCustomTheme(theme: Omit<ColorTheme, 'id'>): ColorTheme {
        const customThemes = getCustomThemes();
        const newTheme: ColorTheme = {
          ...theme,
          id: `custom_${Date.now()}`
        };
        
        customThemes.push(newTheme);
        saveCustomThemes(customThemes);
        this.availableThemes = getAllThemes();
        
        return newTheme;
      },
      
      removeCustomTheme(themeId: string): void {
        const customThemes = getCustomThemes();
        const updatedThemes = customThemes.filter(t => t.id !== themeId);
        
        saveCustomThemes(updatedThemes);
        this.availableThemes = getAllThemes();
        
        // If current theme was removed, switch to default
        if (this.currentTheme.id === themeId) {
          this.setTheme('purple');
        }
      }
    };
  }