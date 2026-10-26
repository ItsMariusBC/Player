// components/control/theme-switcher.tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ColorTheme, createThemeManager } from "@/lib/theme-manager";

const inputVariants = "bg-transparent rounded-lg bg-purple-200/10 text-sm px-2 py-1 -mx-2 placeholder:text-purple-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";

export function ThemeSwitcherDialog() {
  const [open, setOpen] = useState(false);
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({
            variant: "secondary",
          }),
        )}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
        Theme
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <ThemeManager onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ThemeManager({ onClose: _onClose }: { onClose: () => void }) {
  const [themes, setThemes] = useState<ColorTheme[]>([]);
  const [currentThemeId, setCurrentThemeId] = useState<string>('');
  const [showCustomForm, setShowCustomForm] = useState(false);
  
  // Initialize theme manager
  const [themeManager] = useState(() => 
    createThemeManager({
      onThemeChange: (theme) => {
        setCurrentThemeId(theme.id);
      }
    })
  );
  
  // Load themes on component mount
  useEffect(() => {
    setThemes(themeManager.availableThemes);
    setCurrentThemeId(themeManager.currentTheme.id);
  }, [themeManager]);
  
  const handleThemeChange = (themeId: string) => {
    themeManager.setTheme(themeId);
    setCurrentThemeId(themeId);
  };
  
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">Theme Settings</h2>
        <p className="text-purple-200 text-sm mb-4">
          Customize the look and feel of your player
        </p>
      </div>
      
      {/* Theme Grid */}
      <div className="grid grid-cols-2 gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={cn(
              "flex flex-col items-center p-3 rounded-lg border-2 transition-all",
              theme.id === currentThemeId 
                ? "border-purple-400" 
                : "border-transparent hover:border-purple-200/30"
            )}
            onClick={() => handleThemeChange(theme.id)}
          >
            {/* Theme Preview Circle */}
            <div className="flex flex-row gap-1 mb-2">
              {theme.gradient.map((color, i) => (
                <div 
                  key={i}
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <span className="text-sm">{theme.name}</span>
            {theme.id.startsWith("custom_") && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  themeManager.removeCustomTheme(theme.id);
                  setThemes(themeManager.availableThemes);
                }}
                className="mt-1 text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            )}
          </button>
        ))}
      </div>
      
      {/* Add Custom Theme Button */}
      <button
        className={cn(buttonVariants({ variant: "secondary" }))}
        onClick={() => setShowCustomForm(!showCustomForm)}
      >
        {showCustomForm ? "Cancel" : "Create Custom Theme"}
      </button>
      
      {/* Custom Theme Form */}
      {showCustomForm && <CustomThemeForm themeManager={themeManager} onComplete={() => {
        setShowCustomForm(false);
        setThemes(themeManager.availableThemes);
      }} />}
    </div>
  );
}

function CustomThemeForm({ 
  themeManager, 
  onComplete 
}: { 
  themeManager: ReturnType<typeof createThemeManager>; 
  onComplete: () => void 
}) {
  const [name, setName] = useState("My Custom Theme");
  const [primary, setPrimary] = useState("#8855ff");
  const [secondary, setSecondary] = useState("#6655aa");
  const [background, setBackground] = useState("#13041f");
  const [text, setText] = useState("#e0ccff");
  const [gradient1, setGradient1] = useState("#8855ff");
  const [gradient2, setGradient2] = useState("#6655aa");
  const [gradient3, setGradient3] = useState("#13041f");
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    themeManager.addCustomTheme({
      name,
      primary,
      secondary,
      background,
      text,
      gradient: [gradient1, gradient2, gradient3]
    });
    
    onComplete();
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="font-medium text-sm">Create Custom Theme</h3>
      
      <div className="flex flex-col">
        <label htmlFor="name" className="text-xs font-medium mb-1">Theme Name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputVariants}
          required
        />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <label htmlFor="primary" className="text-xs font-medium mb-1">Primary Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="primary"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className={inputVariants}
              pattern="^#[0-9A-Fa-f]{6}$"
              required
            />
          </div>
        </div>
        
        <div className="flex flex-col">
          <label htmlFor="secondaryColor" className="text-xs font-medium mb-1">Secondary Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="secondaryColor"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              className={inputVariants}
              pattern="^#[0-9A-Fa-f]{6}$"
              required
            />
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <label htmlFor="bgColor" className="text-xs font-medium mb-1">Background Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="bgColor"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              className={inputVariants}
              pattern="^#[0-9A-Fa-f]{6}$"
              required
            />
          </div>
        </div>
        
        <div className="flex flex-col">
          <label htmlFor="text" className="text-xs font-medium mb-1">Text Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={inputVariants}
              pattern="^#[0-9A-Fa-f]{6}$"
              required
            />
          </div>
        </div>
      </div>
      
      <div>
        <label className="text-xs font-medium mb-1">Gradient Colors</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={gradient1}
            onChange={(e) => setGradient1(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
          />
          <input
            type="color"
            value={gradient2}
            onChange={(e) => setGradient2(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
          />
          <input
            type="color"
            value={gradient3}
            onChange={(e) => setGradient3(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
          />
        </div>
      </div>
      
      <div className="pt-2">
        <button
          type="submit"
          className={cn(buttonVariants({ variant: "primary" }))}
        >
          Create Theme
        </button>
      </div>
    </form>
  );
}
