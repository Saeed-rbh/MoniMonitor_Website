import React, { FormEvent } from "react";
import { Amplify } from "aws-amplify";
import { signUp } from "aws-amplify/auth"
import amplifyConfig from '../amplifyconfiguration.json';

Amplify.configure(amplifyConfig);

interface SignUpFormElements extends HTMLFormControlsCollection {
  email: HTMLInputElement;
  password: HTMLInputElement;
}

interface SignUpForm extends HTMLFormElement {
  readonly elements: SignUpFormElements;
}

export default function SignUpComp() {
  async function handleSubmit(event: FormEvent<SignUpForm>) {
    event.preventDefault()
    const form = event.currentTarget
    // ... validate inputs
    await signUp({
      username: form.elements.email.value,
      password: form.elements.password.value,
    })
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