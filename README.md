# PEGA LEANDRINHO 🏭

Jogo de plataforma 2D onde você é o Leandrinho, fugindo dos Geraldos pela fábrica de móveis. Seis fases (Marcenaria, Ateliê, Tecelagem, Tubular, Externo e Engenharia), cada uma com cenário, inimigos e NPCs próprios, terminando num confronto final contra o Geraldo-chefe pra resgatar a Mayra e o Marco Túlio.

100% offline, sem dependências externas (só as fontes do Google Fonts, que também funcionam com o navegador offline depois do primeiro carregamento em cache).

## Como publicar no GitHub Pages

1. Crie um repositório novo no GitHub (pode ser público ou privado com Pages habilitado).
2. Suba **todos os arquivos desta pasta** mantendo a mesma estrutura:
   ```
   index.html
   game.js
   manifest.json
   icons/
   assets/
   ```
3. No repositório, vá em **Settings → Pages**.
4. Em "Source", selecione a branch `main` (ou `master`) e a pasta `/root`.
5. Salve. Em alguns minutos o jogo estará disponível em:
   `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`

## Rodar localmente

Basta abrir o `index.html` num navegador. Como é um PWA, dá pra "instalar" no celular (Chrome → menu → "Adicionar à tela inicial") e jogar offline como um app normal, com o ícone que você mandou.

## Estrutura

- `index.html` — telas (início, jogo, game over, fase concluída, vitória, histórico) e estilo
- `game.js` — todo o motor do jogo (física, fases, personagens, inimigos, chefe final)
- `manifest.json` — configuração do PWA (nome, ícone, cores)
- `icons/` — ícone do app em diferentes tamanhos
- `assets/` — logo e ilustrações usadas nas telas de menu/vitória/game over

## Controles

- Teclado: setas ou A/D para mover, espaço/W/seta pra cima para pular
- Celular: botões ◀ ▶ e o botão amarelo de pular na tela
