import { useRef, useState } from 'react';
import { useChat } from '../../context/chatContext.ts';
import { useAvatarSrc } from '../../hooks/useAvatarSrc.ts';
import { avatarStore } from '../../services/avatars.ts';
import { AVATAR_ACCEPT, squareJpeg } from '../../utils/cropImage.ts';
import { Avatar } from '../common/Avatar.tsx';

/** The profile photo row in Settings: upload a picture (cut square and shrunk here first) or remove it. */
export function ProfilePhotoSettings({ onError }: { onError: (message: string | null) => void }) {
  const { user, actions } = useChat();
  const src = useAvatarSrc(user.id);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const hasPhoto = avatarStore.has(user.id);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    onError(null);
    try {
      await work();
    } catch (e: any) {
      onError(e?.message || 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const upload = (file: File) =>
    run(async () => {
      let picture: Blob;
      try {
        picture = await squareJpeg(file);
      } catch {
        throw new Error('That file is not a picture this browser can read. Use a JPEG, PNG or WebP.');
      }
      await actions.setProfilePhoto(picture);
    });

  return (
    <div className="togrow" data-testid="profile-photo">
      <span className="ph-prev">
        <Avatar name={user.fullName} src={src} />
      </span>
      <span className="tx">
        <b>Profile photo</b>
        <span>Shown on your messages, calls and profile</span>
      </span>
      <input
        ref={picker}
        type="file"
        accept={AVATAR_ACCEPT}
        hidden
        data-testid="profile-photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <button className="joinb" disabled={busy} onClick={() => picker.current?.click()}>
        {busy ? 'Saving…' : 'Upload'}
      </button>
      {hasPhoto && (
        <button
          className="joinb leave"
          disabled={busy}
          data-testid="profile-photo-remove"
          onClick={() => void run(() => actions.removeProfilePhoto())}
        >
          Remove
        </button>
      )}
    </div>
  );
}
