// seed.js — Popula o Firestore com dados iniciais
// Uso: node seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, getNextId } = require('./db');

async function seed() {
  console.log('🌱 Iniciando seed do Firestore...\n');

  // ── 1. Admin user ────────────────────────────────────────────────────────
  console.log('👤 Criando usuário admin...');
  const adminEmail = 'admin@esportivanaviea.com';
  const existing = await db.collection('users').where('email', '==', adminEmail).limit(1).get();

  let adminId;
  if (existing.empty) {
    const hash = await bcrypt.hash('admin123', 10);
    adminId = await getNextId('users');
    await db.collection('users').doc(String(adminId)).set({
      name:            'Administrador',
      email:           adminEmail,
      password:        hash,
      role:            'ADMIN',
      avatar_initials: 'AD',
      avatar_color:    '#FF6B35',
      total_points:    0,
      created_at:      new Date().toISOString()
    });
    console.log(`   ✅ Admin criado (id=${adminId})`);
  } else {
    adminId = existing.docs[0].id;
    console.log('   ℹ️  Admin já existe, pulando.');
  }

  // ── 2. Operador de exemplo (para testar ranking) ─────────────────────────
  console.log('\n👤 Criando operador de exemplo...');
  const opEmail = 'operador@esportivanaviea.com';
  const opExisting = await db.collection('users').where('email', '==', opEmail).limit(1).get();

  let opId;
  if (opExisting.empty) {
    const hash = await bcrypt.hash('operador123', 10);
    opId = await getNextId('users');
    await db.collection('users').doc(String(opId)).set({
      name:            'Operador Exemplo',
      email:           opEmail,
      password:        hash,
      role:            'OPERATOR',
      avatar_initials: 'OE',
      avatar_color:    '#00C2FF',
      total_points:    0,
      created_at:      new Date().toISOString()
    });
    // Cria entrada no ranking com role desnormalizado
    await db.collection('rankings').doc(String(opId)).set({
      user_id:           String(opId),
      role:              'OPERATOR',
      total_points:      0,
      quiz_points:       0,
      simulator_points:  0,
      modules_completed: 0,
      rank_position:     1
    });
    console.log(`   ✅ Operador criado (id=${opId})`);
  } else {
    opId = opExisting.docs[0].id;
    console.log('   ℹ️  Operador já existe, pulando.');
  }

  // ── 3. Fase de exemplo ───────────────────────────────────────────────────
  console.log('\n📚 Criando fase de exemplo...');
  const phaseId = await getNextId('phases');
  await db.collection('phases').doc(String(phaseId)).set({
    title:       'Fase 1 — Fundamentos',
    description: 'Conceitos básicos de apostas esportivas',
    icon:        '⚽',
    color:       '#00C2FF',
    order_index: 1,
    is_active:   true,
    is_locked:   false,
    created_by:  String(adminId),
    created_at:  new Date().toISOString()
  });
  console.log(`   ✅ Fase criada (id=${phaseId})`);

  // ── 4. Módulo de exemplo ─────────────────────────────────────────────────
  console.log('\n📝 Criando módulo de exemplo...');
  const moduleId = await getNextId('modules');
  await db.collection('modules').doc(String(moduleId)).set({
    phase_id:    phaseId,
    title:       'Introdução às Odds',
    description: 'Entenda como funcionam as cotações',
    content:     '<p>Bem-vindo ao módulo de introdução às odds!</p>',
    order_index: 1,
    is_active:   true,
    video_url:   null,
    pdf_url:     null,
    created_by:  String(adminId),
    created_at:  new Date().toISOString()
  });
  console.log(`   ✅ Módulo criado (id=${moduleId})`);

  // ── 5. Questão de quiz ───────────────────────────────────────────────────
  console.log('\n❓ Criando questão de quiz...');
  const questionId = await getNextId('quiz_questions');
  await db.collection('quiz_questions').doc(String(questionId)).set({
    module_id:      moduleId,
    question:       'O que significa uma odd de 2.00?',
    option_a:       'Você ganha o dobro do valor apostado',
    option_b:       'Você perde metade do valor apostado',
    option_c:       'Você ganha 200% de lucro',
    option_d:       'O time tem 50% de chance de vencer',
    option_e:       null,
    correct_option: 'A',
    explanation:    'Uma odd de 2.00 significa que para cada R$1 apostado, você recebe R$2 de volta (lucro de R$1).',
    points:         10,
    order_index:    1,
    created_at:     new Date().toISOString()
  });
  console.log(`   ✅ Questão criada (id=${questionId})`);

  // ── 6. Simulador de exemplo ──────────────────────────────────────────────
  console.log('\n🎮 Criando simulador de exemplo...');
  const simId = await getNextId('simulators');
  await db.collection('simulators').doc(String(simId)).set({
    module_id:   moduleId,
    title:       'Simulador de Atendimento',
    description: 'Pratique o atendimento ao cliente sobre odds',
    scenario:    'Você é um operador e um cliente quer entender como funcionam as odds fracionárias. Responda de forma clara e educada.',
    is_active:   true,
    created_at:  new Date().toISOString()
  });

  const sqId = await getNextId('simulator_questions');
  await db.collection('simulator_questions').doc(String(sqId)).set({
    simulator_id: String(simId),
    question:     'Como você explicaria uma odd de 3/1 para um cliente iniciante?',
    order_index:  1
  });
  console.log(`   ✅ Simulador criado (id=${simId})`);

  console.log('\n✅ Seed concluído com sucesso!');
  console.log('\n📋 Credenciais:');
  console.log(`   Admin:    admin@esportivanaviea.com  /  admin123`);
  console.log(`   Operador: operador@esportivanaviea.com  /  operador123`);
  console.log('\n⚠️  Troque as senhas após o primeiro login!\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Erro no seed:', err);
  process.exit(1);
});
