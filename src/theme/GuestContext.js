import React, { createContext, useContext, useState } from 'react';

const GuestContext = createContext({ isGuest: false, setIsGuest: () => {} });

// Accepts optional controlled isGuest/setIsGuest from AppNavigator.
// If not provided, manages its own state (for standalone use).
export function GuestProvider({ children, isGuest: controlledIsGuest, setIsGuest: controlledSet }) {
  const [ownIsGuest, setOwnIsGuest] = useState(false);
  const isGuest = controlledIsGuest !== undefined ? controlledIsGuest : ownIsGuest;
  const setIsGuest = controlledSet ?? setOwnIsGuest;

  return (
    <GuestContext.Provider value={{ isGuest, setIsGuest }}>
      {children}
    </GuestContext.Provider>
  );
}

export function useGuest() {
  return useContext(GuestContext);
}
