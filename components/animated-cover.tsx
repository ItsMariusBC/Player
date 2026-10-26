// components/animated-cover.tsx
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { QueueItem } from "@/lib/queue-manager";

export function AnimatedCover({ song }: { song: QueueItem }) {
  const [isRotating, setIsRotating] = useState(false);
  
  // Démarrer la rotation quand une chanson est en lecture
  useEffect(() => {
    setIsRotating(true);
    
    // Réinitialiser l'animation si la chanson change
    return () => setIsRotating(false);
  }, [song.id]);
  
  return (
    <motion.div 
      className="relative"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {song.picture ? (
        <motion.img 
          src={song.picture}
          alt={song.name}
          className="size-24 rounded-lg shadow-lg object-cover"
          initial={{ scale: 0.8, opacity: 0, rotate: -5 }}
          animate={{ 
            scale: 1, 
            opacity: 1, 
            rotate: isRotating ? 0 : -5,
            transition: { duration: 0.6, ease: "easeOut" }
          }}
          exit={{ scale: 0.8, opacity: 0, rotate: 5 }}
          drag
          dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
          dragElastic={0.2}
        />
      ) : (
        <motion.div
          className="size-24 rounded-lg bg-purple-400/20 flex items-center justify-center shadow-lg"
          initial={{ scale: 0.8, opacity: 0, rotate: -5 }}
          animate={{ 
            scale: 1, 
            opacity: 1, 
            rotate: 0,
            transition: { duration: 0.6, ease: "easeOut" }
          }}
          exit={{ scale: 0.8, opacity: 0, rotate: 5 }}
        >
          <svg
            width="42"
            height="42"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </motion.div>
      )}
      
      {/* Effet de reflet et ombre portée */}
      <motion.div 
        className="absolute -bottom-6 left-0 right-0 h-6 opacity-20 blur-sm"
        style={{ 
          background: 'linear-gradient(to bottom, currentColor, transparent)',
          transform: 'scaleY(-1)'
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.2 }}
      />
      
      {/* Animation de pulsation pour indiquer la lecture */}
      <motion.div
        className="absolute inset-0 rounded-lg border-2 border-purple-300/30"
        animate={{
          scale: [1, 1.05, 1],
          borderWidth: ["2px", "0px", "2px"],
          opacity: [1, 0.5, 1],
        }}
        transition={{
          duration: 2,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      />
    </motion.div>
  );
}