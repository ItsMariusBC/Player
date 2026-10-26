// components/menu.tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PlayerControls } from "@/components/control/player-controls";
import { MusicManager } from "@/lib/music-manager";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";
import { CreateCustomSongDialog } from "@/components/control/create-custom-song";
import { ThemeSwitcherDialog } from "@/components/control/theme-switcher";
import { VisualizerSettingsDialog } from "@/components/music-visualizer/enhanced-visualizer";
import { PlaylistsDialog } from "@/components/control/playlists";
import { SongRecognitionDialog } from "@/components/song-recognition";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";

export function Menu({ musicManager }: { musicManager: MusicManager }) {
  const [activeTab, setActiveTab] = useState("controls");
  
  // Save/restore last active tab
  useEffect(() => {
    const lastTab = localStorage.getItem("menu_active_tab");
    if (lastTab) {
      setActiveTab(lastTab);
    }
  }, []);
  
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    localStorage.setItem("menu_active_tab", value);
  };
  
  return (
    <Popover>
      <PopoverTrigger
        id="menu-trigger"
        aria-label="Menu"
        className={cn(
          buttonVariants({
            variant: "ghost",
            className: "max-md:absolute max-md:top-8 max-md:right-8",
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
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
        Menu
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="controls" className="flex-1">Controls</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
          </TabsList>
          
          <TabsContent value="controls">
            <PlayerControls musicManager={musicManager} />
            
            <div className="grid grid-cols-2 gap-2 mt-4">
              <PlaylistsDialog musicManager={musicManager} />
              <SongRecognitionDialog musicManager={musicManager} />
              <CreateCustomSongDialog musicManager={musicManager} />
              <a
                href="https://github.com/Its-SheldonDev/"
                target="_blank"
                className={cn(
                  buttonVariants({
                    variant: "secondary",
                  }),
                )}
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </div>
          </TabsContent>
          
          <TabsContent value="settings">
            <div className="grid grid-cols-2 gap-2">
              <ThemeSwitcherDialog />
              <VisualizerSettingsDialog />
            </div>
            
            <div className="mt-4 pt-4 border-t border-purple-200/10">
              <h3 className="text-sm font-medium mb-2">About</h3>
              <p className="text-xs text-purple-200">
                Sheldon Player v2.0
                <br />
                An elegant and customizable music player.
                <br />
                © 2025 Sheldon Dev
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}