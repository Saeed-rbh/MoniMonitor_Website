import React, { FormEvent } from "react";
import { Amplify } from "aws-amplify"
import { signIn } from "aws-amplify/auth"
import amplifyConfig from '../amplifyconfiguration.json';

Amplify.configure(amplifyConfig);

interface SignInFormElements extends HTMLFormControlsCollection {
  email: HTMLInputElement
  password: HTMLInputElement
}

interface SignInForm extends HTMLFormElement {
  readonly elements: SignInFormElements
}

export default function SignInComp({setAuthState}) {

  async function handleSubmit(event: FormEvent<SignInForm>) {
    event.preventDefault();
    const form = event.currentTarget;

    try {
    await signIn({
        username: form.elements.email.value,
        password: form.elements.password.value,
      })
      console.log("Sign in successful!");
    await setAuthState(true);
    } catch (error) {
      console.error("Error during sign in:", error);
      alert("Sign in failed: " + error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="email">Email:</label>
      <input type="text" id="email" name="email" />
      <label htmlFor="password">Password:</label>
      <input type="password" id="password" name="password" />
      <input type="submit" />
    </form>
  )
}