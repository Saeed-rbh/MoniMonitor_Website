import React from "react";
import { Amplify } from "aws-amplify"
import { signOut } from "aws-amplify/auth"
import amplifyConfig from '../amplifyconfiguration.json';

Amplify.configure(amplifyConfig);

export default function SignOutComp({setAuthState}) {
  async function handleSignOut() {
    await signOut()
    await setAuthState(false)
  }

  return (
    <div  onClick={handleSignOut} style={{
        backgroundColor: "red",
        color: "white",
        padding: "10px",
        borderRadius: "5px",
        cursor: "pointer",
        border: "none",
        position: "absolute",
        top: "10px",
        right: "10px",
    }}>
      Sign out
    </div>
  )
}