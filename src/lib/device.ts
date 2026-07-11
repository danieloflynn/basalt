import { isDesktopPlatform } from '@/engine';

/** The noun for the device Basalt is running on, for user-visible copy. */
export function deviceNoun(): 'Mac' | 'phone' {
  return isDesktopPlatform ? 'Mac' : 'phone';
}

/** Capitalized possessive form ("This Mac's" / "Your phone's") for sentence-initial use. */
export function deviceNounPossessive(): "This Mac's" | "Your phone's" {
  return isDesktopPlatform ? "This Mac's" : "Your phone's";
}

/** Where the GitHub access token is stored at rest, for user-visible copy. */
export function keystoreName(): string {
  return isDesktopPlatform ? 'the macOS Keychain' : "Android's secure keystore";
}
