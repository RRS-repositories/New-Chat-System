/**
 * Profile photos, for the whole app.
 *
 * The server tells us each person's photo address (it changes whenever the photo does). A photo
 * needs the sign-in token to fetch, so an <img> cannot load it directly: it is fetched once here
 * and handed out as a browser-local address. Kept outside React state on purpose: an avatar is
 * drawn hundreds of times on a page, and only the avatars of the person whose photo changed
 * should redraw.
 */
type FetchBlob = (path: string) => Promise<Blob>;
type Listener = () => void;

const addresses = new Map<number, string>(); // person → the server's address for their photo
const pictures = new Map<string, string | 'loading' | 'failed'>(); // server address → browser-local address
const listeners = new Map<number, Set<Listener>>();
let fetchBlob: FetchBlob | null = null;

function notify(userId: number) {
  for (const listener of listeners.get(userId) ?? []) listener();
}

function forget(address: string | undefined) {
  if (!address) return;
  const picture = pictures.get(address);
  if (picture && picture !== 'loading' && picture !== 'failed') URL.revokeObjectURL(picture);
  pictures.delete(address);
}

function load(userId: number, address: string) {
  if (!fetchBlob) return;
  pictures.set(address, 'loading');
  fetchBlob(address)
    .then((blob) => {
      // The photo changed (or was removed) while this one was on its way: drop it.
      if (addresses.get(userId) !== address) {
        pictures.delete(address);
        return;
      }
      pictures.set(address, URL.createObjectURL(blob));
      notify(userId);
    })
    .catch(() => {
      if (pictures.get(address) === 'loading') pictures.set(address, 'failed');
    });
}

export const avatarStore = {
  /** How photos are fetched (with the sign-in token). Set once when the chat starts. */
  configure(fetcher: FetchBlob | null) {
    fetchBlob = fetcher;
  },

  /** One person's photo changed, or was removed (null). */
  set(userId: number, address: string | null) {
    const old = addresses.get(userId);
    if ((old ?? null) === address) return;
    if (address) addresses.set(userId, address);
    else addresses.delete(userId);
    forget(old);
    notify(userId);
  },

  /** Everyone's photo addresses, as sent when the chat loads. People not listed have no photo. */
  setAll(all: Record<string, string | null | undefined>) {
    const next = new Map<number, string>();
    for (const [id, address] of Object.entries(all || {})) if (address) next.set(Number(id), address);
    for (const userId of new Set([...addresses.keys(), ...next.keys()])) this.set(userId, next.get(userId) ?? null);
  },

  /** The address to put in an <img> for this person, or null (no photo, or not loaded yet). Starts the load if needed. */
  get(userId: number | null | undefined): string | null {
    if (userId == null) return null;
    const address = addresses.get(userId);
    if (!address) return null;
    const picture = pictures.get(address);
    if (!picture) {
      load(userId, address);
      return null;
    }
    return picture === 'loading' || picture === 'failed' ? null : picture;
  },

  /** Whether this person has a photo at all (loaded or not). */
  has: (userId: number | null | undefined): boolean => userId != null && addresses.has(userId),

  subscribe(userId: number | null | undefined, listener: Listener): () => void {
    if (userId == null) return () => {};
    if (!listeners.has(userId)) listeners.set(userId, new Set());
    listeners.get(userId)!.add(listener);
    return () => {
      listeners.get(userId)?.delete(listener);
    };
  },

  /** Signing out: let go of every photo. */
  reset() {
    for (const address of pictures.keys()) forget(address);
    for (const userId of [...addresses.keys()]) {
      addresses.delete(userId);
      notify(userId);
    }
  },
};
