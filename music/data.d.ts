export interface Song {
  name: string;
  author: string;
  url: string;
  picture?: string;

  /**
   * Folder shown in the queue. Songs without one are listed at the root.
   */
  folder?: string;

  /**
   * Optional background gradient override (3 colours). When absent the
   * gradient is derived from the cover art at runtime.
   */
  gradient?: [string, string, string];

  /**
   * Whether the song is customised
   */
  isCustom?: boolean;
}
