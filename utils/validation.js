// Regras: mínimo 8 chars, ao menos 1 maiúscula, 1 número, 1 caractere especial
function validatePassword(password) {
  if (typeof password !== 'string') return 'Senha inválida';
  if (password.length < 8)          return 'Senha deve ter ao menos 8 caracteres';
  if (!/[A-Z]/.test(password))      return 'Senha deve conter ao menos uma letra maiúscula';
  if (!/[0-9]/.test(password))      return 'Senha deve conter ao menos um número';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Senha deve conter ao menos um caractere especial (!@#$%...)';
  return null; // válida
}

module.exports = { validatePassword };
