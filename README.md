# Esportiva na Veia

Backend Node.js com Express e Firebase para a plataforma de treinamento da Esportiva na Veia.

## Estrutura

```text
.
|-- api/                  # entrypoint alternativo para deploy serverless
|-- config/               # configuracoes da app, seguranca e ambiente
|-- middleware/           # middlewares HTTP
|-- public/               # frontend estatico (app e admin)
|-- routes/               # endpoints HTTP agrupados por dominio
|-- services/             # regras compartilhadas entre rotas
|-- utils/                # utilitarios puros e helpers do projeto
|-- db.js                 # bootstrap do Firebase Admin / Firestore
|-- seed.js               # carga inicial de dados
|-- server.js             # bootstrap principal do servidor
```

## Pastas principais

- `config/`: valores centralizados de CORS, JWT, paths e CSP
- `routes/`: apenas camada HTTP e validacao de entrada
- `services/`: regras de negocio reaproveitaveis, como ranking e usuarios
- `utils/`: helpers pequenos, serializadores e funcoes de apoio

## Scripts

```bash
npm start
npm run dev
npm run seed
```

## Variaveis importantes

- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `FIREBASE_CREDENTIAL_JSON` ou `FIREBASE_CREDENTIAL_PATH`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `ALLOWED_ORIGINS`

## Convencoes usadas

- IDs de documentos tratados como string com `normalizeId()`
- parsing numerico centralizado em `utils/firestore.js`
- regras compartilhadas extraidas de rotas para `services/`
- configuracao HTTP centralizada em `config/`
