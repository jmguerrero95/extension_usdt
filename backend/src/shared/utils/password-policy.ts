export const STRONG_PASSWORD_MESSAGE =
  'La contrasena debe tener al menos 12 caracteres e incluir mayusculas, minusculas, numeros y simbolos.';

export const isStrongPassword = (value: string): boolean =>
  value.length >= 12 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);
