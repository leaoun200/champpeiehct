import React from 'react';
import { getAvatarUrl } from '@/utils/avatarUtils';

interface UserAvatarProps {
  userId?: string;
  username?: string;
  src?: string;
  size?: number;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function UserAvatar({ userId, username, src, size = 40, className = "", onClick }: UserAvatarProps) {
  // Prefer explicit src (server-provided profile image); otherwise fall back to generated avatar
  const avatarUrl = src && src.length > 0 ? src : getAvatarUrl(userId || '', username);

  return (
    <img
      src={avatarUrl}
      alt={`${username || 'User'} avatar`}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
      onClick={onClick}
    />
  );
}