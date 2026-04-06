<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const showContact = ref(false);
const showSuccess = ref(false);
const showBackToTop = ref(false);
const contactError = ref('');
const contactLoading = ref(false);
const contactName = ref('');
const contactEmail = ref('');
const contactMessage = ref('');

// Scroll handling
const scrollProgress = ref<HTMLElement | null>(null);
const fnav = ref<HTMLElement | null>(null);

function onScroll() {
  const sy = window.scrollY;
  const dh = document.documentElement.scrollHeight - window.innerHeight;
  const pct = dh > 0 ? (sy / dh) * 100 : 0;
  if (scrollProgress.value) scrollProgress.value.style.width = pct + '%';
  if (fnav.value) fnav.value.classList.toggle('scrolled', sy > 20);
  showBackToTop.value = sy > 400;
}

// IntersectionObserver for reveal animations
let observer: IntersectionObserver | null = null;

function initRevealObserver() {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
  document.querySelectorAll('.reveal').forEach((el) => observer?.observe(el));
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleContactSubmit(e: Event) {
  e.preventDefault();
  contactError.value = '';

  if (!contactName.value.trim() || !contactEmail.value.trim()) {
    contactError.value = 'name and email are required.';
    return;
  }
  if (!isValidEmail(contactEmail.value.trim())) {
    contactError.value = 'please enter a valid email address.';
    return;
  }

  const webhookUrl = import.meta.env.VITE_CONTACT_WEBHOOK_URL;
  if (!webhookUrl) {
    contactError.value = 'contact form is not configured yet. please try again later.';
    return;
  }

  contactLoading.value = true;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({
        text: `*New Contact Message (Landing Page)*\n*Name:* ${contactName.value.trim()}\n*Email:* ${contactEmail.value.trim()}\n*Message:* ${contactMessage.value.trim()}`,
      }),
    });
    showSuccess.value = true;
  } catch {
    contactError.value = 'Something went wrong. Please try again.';
  } finally {
    contactLoading.value = false;
  }
}

function openContact() {
  showContact.value = true;
  showSuccess.value = false;
}

function closeContact() {
  showContact.value = false;
}

function goToWelcome() {
  router.push('/welcome');
}

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  nextTick(() => initRevealObserver());

  // Open contact modal if navigated with #contact hash (e.g. from blog footer)
  if (window.location.hash === '#contact') {
    openContact();
    history.replaceState(null, '', window.location.pathname);
  }
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  if (observer) {
    observer.disconnect();
    observer = null;
  }
});
</script>

<template>
  <div class="landing-page">
    <!-- Scroll progress bar -->
    <div ref="scrollProgress" class="scroll-progress"></div>

    <!-- FLOATING PILL NAV -->
    <nav ref="fnav" class="fnav">
      <a href="#top" class="fnav__logo" @click.prevent="scrollToTop"
        ><img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" />beanies<span
          class="fnav__logo-orange"
          >.family</span
        ></a
      >
      <div class="fnav__right">
        <div class="fnav__links">
          <a href="#story" @click.prevent="scrollTo('story')">my story</a>
          <a href="#security" @click.prevent="scrollTo('security')">security</a>
          <a href="/beanstalk">blog</a>
        </div>
        <button class="fnav__cta" @click="goToWelcome">create your bean pod</button>
      </div>
    </nav>

    <!-- HERO -->
    <section id="top" class="hero">
      <!-- Scattered background beans -->
      <div class="hero__bean" style="left: 6%; top: 10%; transform: rotate(-15deg)">&#x1FAD8;</div>
      <div
        class="hero__bean"
        style="font-size: 1.6rem; right: 8%; top: 25%; transform: rotate(20deg)"
      >
        &#x1FAD8;
      </div>
      <div
        class="hero__bean"
        style="bottom: 18%; font-size: 1.5rem; left: 12%; transform: rotate(-30deg)"
      >
        &#x1FAD8;
      </div>
      <div
        class="hero__bean"
        style="font-size: 1.3rem; right: 5%; top: 60%; transform: rotate(10deg)"
      >
        &#x1FAD8;
      </div>
      <div
        class="hero__bean"
        style="bottom: 35%; font-size: 1.8rem; right: 18%; transform: rotate(-20deg)"
      >
        &#x1FAD8;
      </div>

      <!-- Decorative brand character accents (hero) -->
      <img
        src="/brand/beanies_small_bean_favicon_512x512.png"
        alt=""
        class="hero__deco-img"
        style="
          animation: decoFloat1 8s ease-in-out infinite;
          opacity: 0.06;
          right: 12%;
          top: 8%;
          transform: rotate(12deg);
          width: 40px;
        "
      />
      <img
        src="/brand/beanies_open_eyes_transparent_512x512.png"
        alt=""
        class="hero__deco-img"
        style="bottom: 15%; opacity: 0.04; right: 6%; transform: rotate(-8deg); width: 50px"
      />
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="hero__deco-img"
        style="
          animation: decoFloat2 10s ease-in-out infinite;
          left: 4%;
          opacity: 0.05;
          top: 45%;
          transform: rotate(15deg);
          width: 35px;
        "
      />

      <!-- Decorative gradient orbs -->
      <div
        class="hero__deco"
        style="background: var(--sky-silk); height: 400px; right: -150px; top: -100px; width: 400px"
      ></div>
      <div
        class="hero__deco"
        style="
          background: var(--heritage-orange);
          bottom: 10%;
          filter: blur(100px);
          height: 300px;
          left: -120px;
          width: 300px;
        "
      ></div>
      <div
        class="hero__deco"
        style="
          background: var(--terracotta);
          filter: blur(80px);
          height: 200px;
          opacity: 0.04;
          right: 5%;
          top: 40%;
          width: 200px;
        "
      ></div>

      <div class="hero__mascot">
        <img src="/brand/beanies_family_hugging_transparent_512x512.png" alt="the beanies family" />
      </div>

      <h1 class="hero__headline">every. bean.<br /><em>counts.</em></h1>
      <p class="hero__sub">
        one app to manage your family's money, activities, and all the little beans. open source and
        fully encrypted. no ads, no tracking, no nonsense.
      </p>

      <div class="hero__cta-group">
        <button data-testid="homepage-get-started" class="btn-primary" @click="goToWelcome">
          start counting beans &#x1FAD8;
        </button>
        <a class="hero__story-link" href="#story" @click.prevent="scrollTo('story')"
          >why I built this &#x2193;</a
        >
      </div>

      <!-- FLOATING DEVICE SHOWCASE -->
      <div class="showcase">
        <!-- Floating accent card: Net Worth -->
        <div class="hero__float" style="animation-delay: 0s; left: 50px; top: 10px; z-index: 6">
          <div class="hero__float-icon">📈</div>
          <div class="hero__float-label">net worth</div>
          <div class="hero__float-val" style="color: #27ae60">+3.2%</div>
        </div>
        <!-- Floating accent card: Goal -->
        <div
          class="hero__float"
          style="animation-delay: 1.5s; bottom: 60px; right: 50px; z-index: 6"
        >
          <div class="hero__float-icon">🎯</div>
          <div class="hero__float-label">goal reached</div>
          <div class="hero__float-val">$10,000 &#x1F389;</div>
        </div>
        <!-- Floating accent card: Pickup -->
        <div class="hero__float" style="animation-delay: 3s; right: 20px; top: 200px; z-index: 6">
          <div class="hero__float-icon">🚗</div>
          <div class="hero__float-label">reminder</div>
          <div class="hero__float-val" style="font-size: 0.72rem">pick up Emma at 4pm</div>
        </div>
        <!-- Floating accent card: Encrypted -->
        <div
          class="hero__float"
          style="animation-delay: 4.5s; bottom: 140px; left: 30px; z-index: 6"
        >
          <div class="hero__float-icon">🔒</div>
          <div class="hero__float-label">security</div>
          <div class="hero__float-val" style="color: var(--soft-green); font-size: 0.72rem">
            AES-256 encrypted
          </div>
        </div>

        <!-- LEFT: Piggy Bank -->
        <div class="showcase__device showcase__device--left">
          <div class="showcase__device-label"><span>&#x1F437;</span> <span>Piggy Bank</span></div>
          <div class="mock-screen">
            <div class="mock-hero-card">
              <div
                style="
                  align-items: flex-start;
                  display: flex;
                  justify-content: space-between;
                  position: relative;
                "
              >
                <div>
                  <div class="mock-hero-label">&#x1F437; Net Worth</div>
                  <div class="mock-hero-amount">$125,400</div>
                  <div class="mock-hero-change">&#x2191; +12.5% <span>this month</span></div>
                </div>
                <div class="mock-period-pills">
                  <div class="mock-period-pill">1M</div>
                  <div class="mock-period-pill mock-period-pill--active">1Y</div>
                  <div class="mock-period-pill">All</div>
                </div>
              </div>
              <div class="mock-chart-area">
                <svg
                  class="mock-chart-line"
                  viewBox="0 0 280 36"
                  preserveAspectRatio="none"
                  fill="none"
                >
                  <defs>
                    <linearGradient id="cF" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#F15D22" stop-opacity="0.3" />
                      <stop offset="100%" stop-color="#F15D22" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,32 C30,28 60,24 90,20 C120,16 150,22 180,14 C210,8 240,6 280,3"
                    stroke="#F15D22"
                    stroke-width="1.5"
                    fill="none"
                  />
                  <path
                    d="M0,32 C30,28 60,24 90,20 C120,16 150,22 180,14 C210,8 240,6 280,3 L280,36 L0,36 Z"
                    fill="url(#cF)"
                  />
                  <circle
                    cx="280"
                    cy="3"
                    r="2.5"
                    fill="#F15D22"
                    stroke="white"
                    stroke-width="1.5"
                  />
                </svg>
              </div>
            </div>
            <div class="mock-stats-row">
              <div class="mock-stat-card">
                <div class="mock-stat-icon mock-stat-icon--green">📈</div>
                <div class="mock-stat-label">Income</div>
                <div class="mock-stat-amount mock-stat-amount--green">$8,500</div>
              </div>
              <div class="mock-stat-card">
                <div class="mock-stat-icon mock-stat-icon--orange">📉</div>
                <div class="mock-stat-label">Expenses</div>
                <div class="mock-stat-amount mock-stat-amount--orange">$6,200</div>
              </div>
              <div class="mock-stat-card mock-stat-card--dark">
                <div class="mock-stat-icon mock-stat-icon--white">💰</div>
                <div class="mock-stat-label" style="color: rgb(255 255 255 / 40%)">Cash Flow</div>
                <div class="mock-stat-amount" style="color: white">$2,300</div>
              </div>
            </div>
            <div class="mock-accounts-row">
              <div class="mock-account-card">
                <div class="mock-account-header">
                  <span style="font-size: 9px">🏦</span>
                  <span class="mock-account-label">Accounts</span>
                </div>
                <div class="mock-account-item">
                  <span class="mock-account-name">Checking</span
                  ><span class="mock-account-bal">$12,400</span>
                </div>
                <div class="mock-account-item">
                  <span class="mock-account-name">Savings</span
                  ><span class="mock-account-bal">$45,600</span>
                </div>
              </div>
              <div class="mock-account-card">
                <div class="mock-account-header">
                  <span style="font-size: 9px">🎯</span>
                  <span class="mock-account-label">Goals</span>
                </div>
                <div style="margin-bottom: 4px">
                  <div style="display: flex; justify-content: space-between; margin-bottom: 1px">
                    <span class="mock-account-name">Emergency</span
                    ><span
                      style="
                        color: #27ae60;
                        font-family: Outfit, sans-serif;
                        font-size: 6.5px;
                        font-weight: 700;
                      "
                      >82%</span
                    >
                  </div>
                  <div
                    style="
                      background: rgb(44 62 80 / 5%);
                      border-radius: 2px;
                      height: 4px;
                      overflow: hidden;
                    "
                  >
                    <div
                      style="
                        background: linear-gradient(90deg, #f15d22, #e67e22);
                        border-radius: 2px;
                        height: 100%;
                        width: 82%;
                      "
                    ></div>
                  </div>
                </div>
                <div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 1px">
                    <span class="mock-account-name">Vacation</span
                    ><span
                      style="
                        color: var(--heritage-orange);
                        font-family: Outfit, sans-serif;
                        font-size: 6.5px;
                        font-weight: 700;
                      "
                      >45%</span
                    >
                  </div>
                  <div
                    style="
                      background: rgb(44 62 80 / 5%);
                      border-radius: 2px;
                      height: 4px;
                      overflow: hidden;
                    "
                  >
                    <div
                      style="
                        background: linear-gradient(90deg, #f15d22, #e67e22);
                        border-radius: 2px;
                        height: 100%;
                        width: 45%;
                      "
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- CENTER: Family Nook -->
        <div class="showcase__device showcase__device--center">
          <div class="showcase__device-label"><span>&#x1F3E1;</span> <span>Family Nook</span></div>
          <div class="mock-screen">
            <div>
              <div class="mock-greeting">Welcome home, <span>Greg</span></div>
              <div class="mock-date">Monday, March 10, 2026</div>
            </div>
            <div class="mock-toast">
              <div class="mock-toast-header">
                <div class="mock-toast-icon">🌳</div>
                <div>
                  <div class="mock-toast-title">Small steps, big adventures</div>
                  <div class="mock-toast-sub">4 activities, 3 tasks today</div>
                </div>
              </div>
              <div class="mock-toast-sep"></div>
              <div class="mock-toast-item">
                <div class="mock-toast-item-icon">🚗</div>
                <div class="mock-toast-item-text">Pick up Emma from Soccer at 4pm</div>
              </div>
              <div class="mock-toast-item">
                <div class="mock-toast-item-icon">📋</div>
                <div class="mock-toast-item-text">Sarah asked you to buy groceries</div>
              </div>
            </div>
            <div class="mock-beans-row">
              <div class="mock-bean">
                <div class="mock-bean-avatar" style="border-color: #3b82f6">
                  <img src="/brand/beanies_father_icon_transparent_360x360.png" alt="" />
                </div>
                <div class="mock-bean-name">Greg</div>
              </div>
              <div class="mock-bean">
                <div class="mock-bean-avatar" style="border-color: #ec4899">
                  <img src="/brand/beanies_mother_icon_transparent_350x350.png" alt="" />
                </div>
                <div class="mock-bean-name">Sarah</div>
              </div>
              <div class="mock-bean">
                <div class="mock-bean-avatar" style="border-color: #f59e0b">
                  <img src="/brand/beanies_baby_girl_icon_transparent_300x300.png" alt="" />
                </div>
                <div class="mock-bean-name">Emma</div>
              </div>
              <div class="mock-bean">
                <div class="mock-bean-avatar" style="border-color: #10b981">
                  <img src="/brand/beanies_baby_boy_icon_transparent_300x300.png" alt="" />
                </div>
                <div class="mock-bean-name">Liam</div>
              </div>
            </div>
            <div class="mock-schedule-row">
              <div class="mock-schedule-card mock-schedule-card--sky">
                <div class="mock-schedule-header">
                  <div class="mock-schedule-label">📆 Today</div>
                  <div class="mock-schedule-badge mock-schedule-badge--sky">Mar 10</div>
                </div>
                <div class="mock-schedule-item">
                  <div class="mock-schedule-item-icon mock-schedule-item-icon--sky">📚</div>
                  <div>
                    <div class="mock-item-title">Piano Lesson</div>
                    <div class="mock-item-time">3pm · Emma</div>
                  </div>
                </div>
                <div class="mock-schedule-item">
                  <div class="mock-schedule-item-icon mock-schedule-item-icon--sky">⚽</div>
                  <div>
                    <div class="mock-item-title">Soccer Practice</div>
                    <div class="mock-item-time">4pm · Liam</div>
                  </div>
                </div>
              </div>
              <div class="mock-schedule-card mock-schedule-card--orange">
                <div class="mock-schedule-header">
                  <div class="mock-schedule-label">🗓️ This Week</div>
                  <div class="mock-schedule-badge mock-schedule-badge--orange">Calendar →</div>
                </div>
                <div class="mock-schedule-item">
                  <div class="mock-schedule-item-icon mock-schedule-item-icon--orange">🏥</div>
                  <div>
                    <div class="mock-item-title">Dentist</div>
                    <div class="mock-item-time">Tue · 10am</div>
                  </div>
                </div>
                <div class="mock-schedule-item">
                  <div class="mock-schedule-item-icon mock-schedule-item-icon--orange">🥋</div>
                  <div>
                    <div class="mock-item-title">Taekwondo</div>
                    <div class="mock-item-time">Wed · 5pm</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT: Family Planner -->
        <div class="showcase__device showcase__device--right">
          <div class="showcase__device-label"><span>📅</span> <span>Family Planner</span></div>
          <div class="mock-screen" style="gap: 5px">
            <div class="mock-planner-header">
              <div>
                <div class="mock-planner-title">📅 March 2026</div>
                <div class="mock-planner-sub">12 activities this month</div>
              </div>
              <div class="mock-add-btn">+ Add</div>
            </div>
            <div style="align-items: center; display: flex; justify-content: space-between">
              <div class="mock-view-toggle">
                <div class="mock-view-btn mock-view-btn--active">Month</div>
                <div class="mock-view-btn">Week</div>
              </div>
              <div class="mock-member-chips">
                <div class="mock-member-chip mock-member-chip--active">All</div>
                <div class="mock-member-chip">
                  <div class="mock-member-chip-dot" style="background: #3b82f6"></div>
                  Greg
                </div>
                <div class="mock-member-chip">
                  <div class="mock-member-chip-dot" style="background: #ec4899"></div>
                  Sarah
                </div>
              </div>
            </div>
            <div class="mock-calendar">
              <div class="mock-cal-header">
                <div class="mock-cal-day-label">S</div>
                <div class="mock-cal-day-label">M</div>
                <div class="mock-cal-day-label">T</div>
                <div class="mock-cal-day-label">W</div>
                <div class="mock-cal-day-label">T</div>
                <div class="mock-cal-day-label">F</div>
                <div class="mock-cal-day-label">S</div>
              </div>
              <div class="mock-cal-grid">
                <div class="mock-cal-cell mock-cal-cell--has-events">1</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-multi">2</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">3</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-blue">4</div>
                <div class="mock-cal-cell">5</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">6</div>
                <div class="mock-cal-cell">7</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-blue">8</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-multi">9</div>
                <div class="mock-cal-cell mock-cal-cell--today mock-cal-cell--has-events-multi">
                  10
                </div>
                <div class="mock-cal-cell mock-cal-cell--has-events">11</div>
                <div class="mock-cal-cell">12</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">13</div>
                <div class="mock-cal-cell">14</div>
                <div class="mock-cal-cell">15</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">16</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-blue">17</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-multi">18</div>
                <div class="mock-cal-cell">19</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">20</div>
                <div class="mock-cal-cell">21</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">22</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-multi">23</div>
                <div class="mock-cal-cell">24</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">25</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-blue">26</div>
                <div class="mock-cal-cell">27</div>
                <div class="mock-cal-cell">28</div>
                <div class="mock-cal-cell mock-cal-cell--has-events">29</div>
                <div class="mock-cal-cell mock-cal-cell--has-events-multi">30</div>
                <div class="mock-cal-cell">31</div>
                <div class="mock-cal-cell mock-cal-cell--other">1</div>
                <div class="mock-cal-cell mock-cal-cell--other">2</div>
                <div class="mock-cal-cell mock-cal-cell--other">3</div>
                <div class="mock-cal-cell mock-cal-cell--other">4</div>
              </div>
            </div>
            <!-- Today mini-strip -->
            <div style="display: flex; gap: 5px">
              <div
                style="
                  background: white;
                  border-left: 2px solid var(--heritage-orange);
                  border-radius: 8px;
                  box-shadow: 0 1px 6px rgb(44 62 80 / 3%);
                  flex: 1;
                  padding: 5px 7px;
                "
              >
                <div
                  style="
                    font-family: Outfit, sans-serif;
                    font-size: 6px;
                    font-weight: 700;
                    margin-bottom: 3px;
                    opacity: 0.4;
                    text-transform: uppercase;
                  "
                >
                  📌 Today
                </div>
                <div style="align-items: center; display: flex; gap: 3px; margin-bottom: 2px">
                  <span style="font-size: 8px">📚</span
                  ><span style="font-family: Outfit, sans-serif; font-size: 6.5px; font-weight: 600"
                    >Piano 3pm</span
                  ><span
                    style="
                      background: rgb(249 115 22 / 10%);
                      border-radius: 3px;
                      color: var(--heritage-orange);
                      font-size: 5.5px;
                      font-weight: 600;
                      padding: 1px 3px;
                    "
                    >Emma</span
                  >
                </div>
                <div style="align-items: center; display: flex; gap: 3px">
                  <span style="font-size: 8px">⚽</span
                  ><span style="font-family: Outfit, sans-serif; font-size: 6.5px; font-weight: 600"
                    >Soccer 4pm</span
                  ><span
                    style="
                      background: rgb(16 185 129 / 10%);
                      border-radius: 3px;
                      color: #10b981;
                      font-size: 5.5px;
                      font-weight: 600;
                      padding: 1px 3px;
                    "
                    >Liam</span
                  >
                </div>
              </div>
              <div
                style="
                  background: white;
                  border-left: 2px solid #9b59b6;
                  border-radius: 8px;
                  box-shadow: 0 1px 6px rgb(44 62 80 / 3%);
                  flex: 1;
                  padding: 5px 7px;
                "
              >
                <div
                  style="
                    font-family: Outfit, sans-serif;
                    font-size: 6px;
                    font-weight: 700;
                    margin-bottom: 3px;
                    opacity: 0.4;
                    text-transform: uppercase;
                  "
                >
                  ✅ Tasks
                </div>
                <div style="align-items: center; display: flex; gap: 3px; margin-bottom: 2px">
                  <span
                    style="
                      border: 1.5px solid var(--heritage-orange);
                      border-radius: 1.5px;
                      flex-shrink: 0;
                      height: 6px;
                      width: 6px;
                    "
                  ></span
                  ><span style="font-family: Outfit, sans-serif; font-size: 6.5px; font-weight: 600"
                    >Buy groceries</span
                  >
                </div>
                <div style="align-items: center; display: flex; gap: 3px">
                  <span
                    style="
                      border: 1.5px solid var(--heritage-orange);
                      border-radius: 1.5px;
                      flex-shrink: 0;
                      height: 6px;
                      width: 6px;
                    "
                  ></span
                  ><span style="font-family: Outfit, sans-serif; font-size: 6.5px; font-weight: 600"
                    >Book dentist</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Trust badges -->
      <div class="trust-row">
        <div class="trust-badge">
          <div class="trust-icon">&#x1F512;</div>
          encrypted everything
        </div>
        <div class="trust-badge">
          <div class="trust-icon">&#x1F3E6;</div>
          we (I) can't read your data
        </div>
        <div class="trust-badge">
          <div class="trust-icon">&#x2764;&#xFE0F;</div>
          made by a real dad (me)
        </div>
        <div class="trust-badge">
          <div class="trust-icon">&#x1F6AB;</div>
          no ads. no tracking.
        </div>
      </div>

      <div class="scroll-cue">
        <span>scroll</span>
        <div class="scroll-line"></div>
      </div>
    </section>

    <!-- Transition: Hero → Security -->
    <div class="section-fade section-fade--hero-out"></div>

    <!-- SECURITY -->
    <section id="security" class="security-section">
      <div class="ambient-orb ambient-orb--1"></div>
      <div class="ambient-orb ambient-orb--2"></div>
      <!-- Decorative accent -->
      <img
        src="/brand/beanies_small_bean_favicon_512x512.png"
        alt=""
        class="security-section__deco-accent"
      />
      <div class="container">
        <p class="section-label reveal">privacy &amp; security</p>
        <h2 class="section-title reveal">seriously, I don't want your data</h2>
        <p class="section-subtitle reveal">
          your family's data never touches our servers. we built it that way on purpose, because I
          wouldn't trust my data with you, either. no offense.
        </p>

        <div class="security-grid">
          <div class="security-card reveal reveal-delay-1">
            <div class="security-card__icon">&#x1F510;</div>
            <p class="security-card__title">real encryption, not marketing talk</p>
            <p class="security-card__text">
              AES-256-GCM on everything, at rest and in transit. your data is genuinely unreadable
              to anyone without your key &mdash; including me.
            </p>
          </div>
          <div class="security-card reveal reveal-delay-2">
            <div class="security-card__icon">&#x1F511;</div>
            <p class="security-card__title">you hold the keys</p>
            <p class="security-card__text">
              each family member gets their own password-derived key (PBKDF2) that wraps a shared
              family key (AES-KW). lost your password? I can't help you. that's kinda the whole
              point.
            </p>
          </div>
          <div class="security-card reveal reveal-delay-3">
            <div class="security-card__icon">&#x1F4E6;</div>
            <p class="security-card__title">your storage, your rules</p>
            <p class="security-card__text">
              your encrypted data file lives in your own personal storage. it travels directly to
              your browser &mdash; we never see it, touch it, or store it.
            </p>
          </div>
          <div class="security-card reveal reveal-delay-1">
            <div class="security-card__icon">&#x1F6AB;</div>
            <p class="security-card__title">we don't even own a (real) database</p>
            <p class="security-card__text">
              one lookup table in the cloud maps your family ID to your encrypted data file. that's
              literally it. no analytics, no tracking, no selling your info.
            </p>
          </div>
          <div class="security-card reveal reveal-delay-2">
            <div class="security-card__icon">&#x1F310;</div>
            <p class="security-card__title">go ahead, read the code</p>
            <p class="security-card__text">
              it's all on
              <a
                href="https://github.com/gparker97/beanies-family"
                target="_blank"
                class="story__link"
                >GitHub</a
              >. audit it, fork it, run it on your own machine. if you find something sketchy, open
              an issue. you won't, but I appreciate that you at least thought about it.
            </p>
          </div>
          <div class="security-card reveal reveal-delay-3">
            <div class="security-card__icon">&#x1F9F9;</div>
            <p class="security-card__title">sign out = cache gone (if you want)</p>
            <p class="security-card__text">
              your browser keeps an encrypted cache for speed. wipe it clean anytime you want. no
              breadcrumbs, no leftover beans.
            </p>
          </div>
        </div>

        <img
          src="/brand/beanies_covering_eyes_transparent_512x512.png"
          alt=""
          class="security-section__watermark"
        />
      </div>
    </section>

    <!-- Transition: Security → Story -->
    <div class="section-fade section-fade--to-light"></div>
    <div class="section-fade section-fade--to-story" style="margin-top: -1px"></div>

    <!-- THE BEANIES STORY -->
    <section id="story" class="story-section">
      <div class="ambient-orb ambient-orb--1"></div>
      <div class="ambient-orb ambient-orb--2"></div>
      <!-- Decorative celebrating circle accent -->
      <img
        src="/brand/beanies_celebrating_circle_transparent_300x300.png"
        alt=""
        class="story-section__deco-accent"
      />
      <div class="story-header reveal">
        <img
          src="/brand/beanies_father_son_icon_512x512.png"
          alt="Beanies father and son"
          class="story-header__illustration"
        />
        <p class="section-label">the beanies story</p>
        <h2 class="section-title">okay, here's the deal</h2>
      </div>

      <div class="story__body">
        <p class="story__greeting reveal">Hey, guys! <span class="beanie-emoji">&#x1FAD8;</span></p>

        <p class="reveal">
          Yes, it's <em>actually</em> me. Even AI could not come up with a greeting as mundane as
          "Hey, guys!" Indeed, there are still some things humans are better at than robots, such as
          glorious, unadulterated, deliciously spontaneous non-sequiturs, like how I like to fart
          outside taco trucks on wednesday afternoons. But getting back to the point...
        </p>

        <p class="reveal">
          Since the day I "graduated" college for a real job, put in a solid month of (let's call
          it) work, and witnessed my first paycheck direct-deposited to my bank account,
          <span class="story__highlight">this is the app I've wanted to create.</span> I gazed
          lovingly at the glorious $2,867 (minus taxes) in my account, and dreamt about the day I
          would definitely become a billionaire. Or at least when I wouldn't be a starving student
          anymore.
        </p>

        <p class="reveal">
          It started with a janky spreadsheet. I added formulas, tables, charts. I wanted to keep
          track of how much I spent and saved, and project it forward. I might have even written
          some VB macros, toying with my precious sheet for months (maybe years) trying to get it to
          work the way I wanted.
        </p>

        <p class="reveal">
          Then, the world changed (in, let's say, 2008), and I said to myself, "Hey, self! Why do
          you keep trying to re-invent the wheel (the wheel having been invented earlier that year)?
          There's a million personal finance apps out there! Just download one, you numbskull."
        </p>

        <p class="reveal">
          So I did, and I fiddled with those fickle banking connectors that sync your transactions,
          but always fail. They ask for your online banking credentials 10 times in a row, and
          proceed to not work anyway. Lots of my important transactions were in cash or paid on
          cards. Some banks and cards don't provide reliable APIs. When things did work, it was
          temporary and only tracked what you <em>did</em> spend, not what you <em>planned</em> to
          spend.
        </p>

        <p class="reveal">
          Well, at least I didn't divulge the secret key for all my bank accounts to some nameless
          software corporation. Wait... nevermind.
        </p>

        <p class="reveal">
          In any case, my goal was never to record every last transaction and track my budget down
          to the penny. If that's yours, this app probably isn't for you.
          <span class="story__emphasis">I just wanted a rough idea</span>, so I would know if I was
          going to end up as a hobo in 6 months.
        </p>

        <p class="reveal">
          Then, we had kids. With one (1) child, we could generally manage. After 2 kids, life got
          crazier.
          <span class="story__highlight"
            >Bump that up to 3 (at school age) and welcome to the insane world of chaos and
            confusion and writing readmes to dumb personal family planning apps you vibe coded on a
            whim at 3am.</span
          >
          Or, whatever.
        </p>

        <p class="reveal">
          Soccer practice, piano lessons, math tutor, gymnastics (2 types), chinese classes,
          taekwondo, and don't forget your actual school fees, your rent (or mortgage), and the list
          goes on. Who has to pay for what, and when, and how, and to who? Or is it whom? Also,
          while you were obsessing over the proper application of archaic English grammar rules, you
          realized you forgot to pick up your kid from his baseball tryouts. And it's raining. At
          least he has his umbrella. (Cue glance to the floor to spot the umbrella that fell out of
          his sports bag).
        </p>

        <p class="reveal">
          When my youngest was about 6 months old, my wife started calling him
          <span class="story__pinyin-wrap"
            ><ruby class="story__orange story__pinyin"
              >&#x5C0F;&#x8C46;&#x8C46;<rp>(</rp><rt>xiǎo dòu dou</rt><rp>)</rp></ruby
            ></span
          >. Which in Chinese sounds endearing, but just means
          <span class="story__orange">little bean</span>. Cuz he sort of looked like one. It sounds
          cute in English too, so I called him <span class="story__orange">beanie</span>, and it
          stuck.
        </p>

        <p class="reveal">
          I built this app to track all that stuff I mentioned above: your family finances, what you
          spent and received, what you plan to spend and receive (roughly), and to know how much
          you'll have in the future &mdash; in short, your "wealth".
        </p>

        <p class="reveal">
          But also, I built this to track your <em>actual</em> family life: piano lessons,
          schoolwork, sports practice, ballet class, family vacations (we may even give you advice),
          and, of course, who will pick up whom (yes, <em>whom</em>). In short,
          <span class="story__highlight"
            >anything we can help you with, even in a small way, as you navigate the joys and
            sorrows of a complicated, crowded, chaotic, stressful, but of course, rewarding?</span
          >
          (sorry, I meant, rewarding) <span class="story__highlight">family life.</span>
        </p>

        <p class="reveal">
          It's not a perfect app. It doesn't pull in stuff from google calendar (yet) or sync with
          banks (I doubt it ever will). But it gives you a rough idea of how much you have, how much
          you will have, and what in this heavenly world you actually have to do <em>today</em>. (Of
          course, only if you tell it that stuff first. It's not magic.)
        </p>

        <p class="reveal">
          Treat <a href="https://beanies.family" class="story__link">beanies.family</a> like a
          friend, and it will reward you in spades. Maybe it'll even buy you a beer the next time
          you can spare 22 minutes after work and have $7 saved from meticulously tracking your
          budget every month. (Is that how much beers cost nowadays? I wouldn't know.)
        </p>

        <p class="reveal">
          You can clone and install it for free if you want to run it locally. The data never leaves
          your machine if you don't want it to. We don't even own a database (well, not a real one).
          I don't want your janky finance data anyway, and I'm not picking up your kid for you.
        </p>

        <p class="reveal">
          If you want the cloud version so you can share it with your family (don't worry, your data
          still stays with you), create a family account at
          <a href="https://beanies.family" class="story__link">beanies.family</a>. Just drop me a
          line for an invite code. You could also set up the infra by yourself, but that's a pain
          and you know it.
        </p>

        <p class="reveal" style="margin-bottom: 0.8em">Here's the fun stuff:</p>

        <ul class="story__tech-list reveal">
          <li>
            <span class="story__tech-icon">&#x1F916;</span
            ><span
              ><strong>Claude Max / Opus 4.6</strong> &mdash; Mostly. I may have pitched in a line
              or 2.</span
            >
          </li>
          <li>
            <span class="story__tech-icon">&#x1F4BB;</span
            ><span><strong>Vue 3 / TypeScript</strong> + Vite / Tailwind / Pinia</span>
          </li>
          <li>
            <span class="story__tech-icon">&#x1F4BE;</span
            ><span
              ><strong>IndexedDB</strong> &mdash; to cache encrypted family data in your local
              browser, which you can clear at anytime</span
            >
          </li>
          <li>
            <span class="story__tech-icon">&#x1F512;</span
            ><span
              ><strong>Web Crypto API</strong> &mdash; Your data is fully encrypted in transit and
              at rest (AES-256-GCM), each family member gets their own password-derived key (PBKDF2)
              that wraps a shared family key (AES-KW), and data <em>never</em> leaves your personal
              storage location, except to travel directly to (and from) your browser's (encrypted)
              cache</span
            >
          </li>
          <li>
            <span class="story__tech-icon">&#x1F500;</span
            ><span
              ><strong>Automerge</strong> &mdash; for CRDTs &mdash; adds a bit of heft to the
              package, but we tried rolling our own merge algorithms and trust me, it's not worth it
              &mdash; keeping your data safe is what matters</span
            >
          </li>
          <li>
            <span class="story__tech-icon">&#x1F9EA;</span
            ><span
              ><strong>Vitest + Playwright + Dependabot</strong> &mdash; unit tests, E2E tests, and
              automated dependency updates to keep things secure (seriously, how cool is
              Dependabot!?)</span
            >
          </li>
          <li>
            <span class="story__tech-icon">&#x2601;&#xFE0F;</span
            ><span
              ><strong>One single, stupid, plain vanilla DynamoDB</strong> &mdash; in the cloud to
              map your family ID to your (encrypted) data file, so we can locate it in your personal
              location that only you can access. Nothing else. Anywhere. Ever.</span
            >
          </li>
        </ul>

        <p class="reveal">
          So there it is. If you're a techie nerd like me, run it locally. If you don't want to deal
          with the bs, use <a href="https://beanies.family" class="story__link">beanies.family</a>.
        </p>

        <p class="reveal">
          I'm using <a href="https://beanies.family" class="story__link">beanies</a> to track our
          money, our various (1) houses, our (0) boats, my wife's (currently missing) diamond ring
          (ask my wife where she lost hers.. unfortunately beanies can't tell you that), and more.
          I'll use it even more for their piano lessons, soccer practices, school plays that, as a
          respectable father, I really should attend, and to make sure we don't forget to pick up
          our son from his after school math tutor (again). All while keeping our data safe and
          secure on my family's personal storage (unless I open read access on my data file to the
          world and tell everyone the key. Which I won't. Probably.).
        </p>

        <p class="reveal">
          If you have a question, comment, suggestion, or just wanna say hi, you can reach me below
          or
          <a
            href="https://github.com/gparker97/beanies-family/issues"
            target="_blank"
            class="story__link"
            >raise an issue</a
          >. If you're using beanies for free and wanna drop me a satoshi for my time (or just cuz
          you like the app), that's cool too (1beanks5zbnAcptUeSdrepxqrCzxEuA2z).
        </p>

        <div class="story__signoff reveal">
          <p class="story__signoff-tagline">simplify your family life. every bean counts.</p>
          <p class="story__signoff-name">Peace out, my beans.</p>
          <p class="story__signoff-name">&mdash; Greg</p>
          <img
            src="/brand/beanies_father_son_icon_512x512.png"
            alt="Greg and beanie"
            class="story__signoff-img"
          />
        </div>

        <p
          class="reveal"
          style="
            color: var(--muted-text);
            font-size: 0.78rem;
            margin-top: 32px;
            opacity: 0.5;
            text-align: center;
          "
        >
          beanies.family is open source. see
          <a
            href="https://github.com/gparker97/beanies-family/blob/main/LICENSE"
            class="story__link"
            style="font-size: inherit"
            >LICENSE</a
          >
          and
          <a
            href="https://github.com/gparker97/beanies-family/blob/main/TRADEMARK.md"
            class="story__link"
            style="font-size: inherit"
            >TRADEMARK.md</a
          >
          for details.
        </p>
      </div>
    </section>

    <!-- FINAL CTA -->
    <section class="final-cta">
      <div class="ambient-orb ambient-orb--1"></div>
      <div class="ambient-orb ambient-orb--2"></div>
      <!-- Decorative brand accents -->
      <img
        src="/brand/beanies_celebrating_circle_transparent_300x300.png"
        alt=""
        class="final-cta__hero-img"
      />
      <img
        src="/brand/beanies_neutral_icon_transparent_350x350.png"
        alt=""
        class="final-cta__deco-accent"
      />
      <div class="container">
        <h2 class="final-cta__title reveal">so... ready to count some beans? <em>&#x1FAD8;</em></h2>
        <p class="final-cta__sub reveal">
          it's free. run it locally or login below. yes, it's really free. probably not forever.
        </p>
        <div
          style="display: flex; flex-wrap: wrap; gap: 14px; justify-content: center"
          class="reveal"
        >
          <button class="btn-primary" @click="goToWelcome">create your bean pod &#x1FAD8;</button>
          <a
            href="https://github.com/gparker97/beanies-family"
            target="_blank"
            rel="noopener"
            class="btn-secondary"
          >
            view on GitHub
          </a>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="footer">
      <p class="footer__brand">beanies<span class="footer__brand-orange">.family</span></p>
      <div class="footer__links">
        <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener"
          >GitHub</a
        >
        <router-link to="/beanstalk">blog</router-link>
        <router-link to="/help">help</router-link>
        <router-link to="/welcome">sign in</router-link>
      </div>
      <button class="footer__contact-btn" @click="openContact">
        &#x1F4AC; get in touch with me
      </button>
      <p class="footer__tag">every bean counts.</p>
      <p class="footer__copy">&copy; 2026 beanies.family. open source under MIT license.</p>
    </footer>

    <!-- BACK TO TOP -->
    <Transition name="btt">
      <button
        v-show="showBackToTop"
        class="back-to-top"
        aria-label="Back to top"
        @click="scrollToTop"
      >
        &#x2191;
      </button>
    </Transition>

    <!-- CONTACT MODAL -->
    <div class="contact-overlay" :class="{ active: showContact }" @click.self="closeContact">
      <div class="contact-modal">
        <button class="contact-modal__close" @click="closeContact">&times;</button>
        <p class="contact-modal__title">&#x1FAD8; say hi</p>
        <p class="contact-modal__sub">
          got a question, idea, bug report, or just want to chat? I actually read these.
        </p>
        <form v-if="!showSuccess" class="contact-form" @submit="handleContactSubmit">
          <div class="contact-form__field">
            <label class="contact-form__label"
              >your name <span class="contact-form__required">*</span></label
            >
            <input
              v-model="contactName"
              class="contact-form__input"
              type="text"
              placeholder="e.g. fellow bean counter"
              required
            />
          </div>
          <div class="contact-form__field">
            <label class="contact-form__label"
              >email <span class="contact-form__required">*</span></label
            >
            <input
              v-model="contactEmail"
              class="contact-form__input"
              type="email"
              placeholder="so I can write back"
              required
            />
          </div>
          <div class="contact-form__field">
            <label class="contact-form__label">what's on your mind?</label>
            <textarea
              v-model="contactMessage"
              class="contact-form__textarea"
              placeholder="bugs, ideas, compliments, roasts... all welcome"
            ></textarea>
          </div>
          <p v-if="contactError" class="contact-form__error">{{ contactError }}</p>
          <button type="submit" class="contact-form__submit" :disabled="contactLoading">
            {{ contactLoading ? 'sending...' : 'send it' }} &#x1FAD8;
          </button>
        </form>
        <div v-else class="contact-form__success active">
          <div class="contact-form__success-icon">&#x1FAD8;</div>
          <p class="contact-form__success-msg">message sent!</p>
          <p class="contact-form__success-sub">we'll (I'll) get back to you soon. probably.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* stylelint-disable selector-class-pattern, keyframes-name-pattern, no-descending-specificity */

/* ═══════════════════════════════════════════════
   RESET & VARIABLES (scoped to landing page)
   ═══════════════════════════════════════════════ */
.landing-page {
  --deep-slate: #2c3e50;
  --heritage-orange: #f15d22;
  --sky-silk: #aed6f1;
  --terracotta: #e67e22;
  --cloud-white: #f8f9fa;
  --soft-green: #27ae60;
  --body-text: #4a5568;
  --muted-text: #8896a6;
  --sq: 24px;
  --card-shadow: 0 4px 20px rgb(44 62 80 / 5%);
  --card-hover-shadow: 0 8px 32px rgb(44 62 80 / 10%);

  background: var(--cloud-white);
  color: var(--body-text);
  font-family: Inter, sans-serif;
  line-height: 1.7;
  overflow-x: hidden;
}

/* ═══════════════════════════════════════════════
   FLOATING PILL NAV
   ═══════════════════════════════════════════════ */
.fnav {
  align-items: center;
  backdrop-filter: blur(24px);
  background: rgb(255 255 255 / 82%);
  border: 1px solid rgb(44 62 80 / 6%);
  border-radius: 40px;
  display: flex;
  gap: 12px;
  left: 50%;
  padding: 6px 10px 6px 16px;
  position: fixed;
  top: 16px;
  transform: translateX(-50%);
  transition:
    box-shadow 300ms ease,
    background 500ms ease;
  z-index: 200;
}

.fnav.scrolled {
  box-shadow: 0 4px 24px rgb(44 62 80 / 8%);
}

.fnav__logo {
  align-items: center;
  color: var(--deep-slate);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 1rem;
  font-weight: 700;
  gap: 0;
  text-decoration: none;
  white-space: nowrap;
}

.fnav__logo img {
  border-radius: 8px;
  height: 26px;
  margin-right: 7px;
  width: 26px;
}

.fnav__logo-orange {
  color: var(--heritage-orange);
}

.fnav__right {
  align-items: center;
  display: flex;
  gap: 8px;
}

.fnav__links {
  display: flex;
  gap: 2px;
}

.fnav__links a {
  border-radius: 16px;
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  opacity: 0.35;
  padding: 4px 10px;
  text-decoration: none;
  transition: all 200ms;
  white-space: nowrap;
}

.fnav__links a:hover {
  background: rgb(44 62 80 / 5%);
  opacity: 0.7;
}

.fnav__cta {
  background: var(--heritage-orange);
  border: none;
  border-radius: 20px;
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 6px 16px;
  text-decoration: none;
  transition: all 200ms;
  white-space: nowrap;
}

.fnav__cta:hover {
  background: #d14d1a;
  transform: translateY(-1px);
}

/* ═══════════════════════════════════════════════
   SCROLL PROGRESS BAR
   ═══════════════════════════════════════════════ */
.scroll-progress {
  background: var(--heritage-orange);
  height: 2px;
  left: 0;
  position: fixed;
  top: 0;
  transition: width 150ms linear;
  width: 0%;
  z-index: 300;
}

/* ═══════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════ */
.hero {
  align-items: center;
  background: linear-gradient(180deg, var(--cloud-white) 0%, #edf6fc 50%, var(--cloud-white) 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
  padding: 100px 24px 40px;
  position: relative;
  text-align: center;
}

.hero__bean {
  font-size: 2.2rem;
  opacity: 0.05;
  pointer-events: none;
  position: absolute;
}

.hero__deco {
  border-radius: 50%;
  opacity: 0.06;
  pointer-events: none;
  position: absolute;
}

.hero__deco-img {
  pointer-events: none;
  position: absolute;
}

/* Decorative floating animations for brand character images */
@keyframes decoFloat1 {
  0%,
  100% {
    transform: rotate(12deg) translateY(0);
  }

  50% {
    transform: rotate(12deg) translateY(-6px);
  }
}

@keyframes decoFloat2 {
  0%,
  100% {
    transform: rotate(15deg) translateY(0);
  }

  50% {
    transform: rotate(15deg) translateY(-8px);
  }
}

.hero__headline {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: clamp(2.4rem, 6vw, 4rem);
  font-weight: 800;
  line-height: 1.08;
  margin-bottom: 16px;
  position: relative;
}

.hero__headline em {
  background: linear-gradient(135deg, var(--heritage-orange), var(--terracotta));
  background-clip: text;
  font-style: normal;
  -webkit-text-fill-color: transparent;
}

.hero__sub {
  color: var(--body-text);
  font-size: 1.05rem;
  line-height: 1.7;
  margin-bottom: 28px;
  max-width: 480px;
  opacity: 0.55;
  position: relative;
}

.hero__mascot {
  animation: mascotFloat 5s ease-in-out infinite;
  filter: drop-shadow(0 12px 32px rgb(44 62 80 / 10%));
  height: 180px;
  margin: 0 auto 24px;
  position: relative;
  width: 180px;
}

.hero__mascot img {
  height: 100%;
  object-fit: contain;
  width: 100%;
}

@keyframes mascotFloat {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }

  25% {
    transform: translateY(-6px) rotate(1deg);
  }

  75% {
    transform: translateY(-4px) rotate(-1deg);
  }
}

.hero__cta-group {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
  position: relative;
}

.btn-primary {
  background: linear-gradient(135deg, var(--heritage-orange), var(--terracotta));
  border: none;
  border-radius: 60px;
  box-shadow: 0 8px 32px rgb(241 93 34 / 25%);
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 1rem;
  font-weight: 700;
  padding: 14px 36px;
  text-decoration: none;
  transition: all 200ms ease;
}

.btn-primary:hover {
  box-shadow: 0 12px 40px rgb(241 93 34 / 35%);
  transform: translateY(-2px);
}

.hero__story-link {
  align-items: center;
  background: rgb(44 62 80 / 4%);
  border: 1px solid rgb(44 62 80 / 6%);
  border-radius: 24px;
  color: var(--deep-slate);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  gap: 6px;
  opacity: 0.55;
  padding: 8px 18px;
  text-decoration: none;
  transition: all 200ms;
}

.hero__story-link:hover {
  background: rgb(241 93 34 / 5%);
  border-color: rgb(241 93 34 / 12%);
  color: var(--heritage-orange);
  opacity: 0.85;
}

/* ═══════════════════════════════════════════════
   FLOATING DEVICE SHOWCASE
   ═══════════════════════════════════════════════ */
.showcase {
  height: 440px;
  margin: 32px auto 0;
  max-width: 1000px;
  position: relative;
  width: 100%;
}

.showcase__device {
  background: var(--cloud-white);
  border: 1px solid rgb(44 62 80 / 8%);
  border-radius: 20px;
  box-shadow:
    0 20px 60px rgb(44 62 80 / 12%),
    0 4px 16px rgb(44 62 80 / 6%);
  overflow: hidden;
  position: absolute;
  transition:
    transform 400ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 400ms ease;
}

.showcase__device:hover {
  box-shadow:
    0 28px 72px rgb(44 62 80 / 16%),
    0 8px 24px rgb(44 62 80 / 8%);
  transform: translateY(-6px) !important;
}

.showcase__device--center {
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  width: 360px;
  z-index: 3;
}

.showcase__device--center:hover {
  transform: translateX(-50%) translateY(-6px) !important;
}

.showcase__device--left {
  left: 1%;
  top: 40px;
  transform: rotate(-4deg);
  width: 320px;
  z-index: 2;
}

.showcase__device--left:hover {
  transform: rotate(-4deg) translateY(-6px) !important;
}

.showcase__device--right {
  right: 1%;
  top: 40px;
  transform: rotate(4deg);
  width: 320px;
  z-index: 2;
}

.showcase__device--right:hover {
  transform: rotate(4deg) translateY(-6px) !important;
}

.showcase__device-label {
  align-items: center;
  background: white;
  border-bottom: 1px solid rgb(44 62 80 / 6%);
  display: flex;
  gap: 8px;
  padding: 10px 16px;
}

.showcase__device-label span:first-child {
  font-size: 14px;
}

.showcase__device-label span:last-child {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
}

/* Floating accent cards */
.hero__float {
  animation: heroFloat 6s ease-in-out infinite;
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgb(44 62 80 / 10%);
  font-family: Outfit, sans-serif;
  padding: 12px 16px;
  position: absolute;
  z-index: 5;
}

@keyframes heroFloat {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-8px);
  }
}

.hero__float-icon {
  font-size: 1rem;
  margin-bottom: 3px;
}

.hero__float-label {
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  opacity: 0.3;
  text-transform: uppercase;
}

.hero__float-val {
  font-size: 0.85rem;
  font-weight: 700;
}

/* Trust badges */
.trust-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  margin-top: 20px;
  position: relative;
}

.trust-badge {
  align-items: center;
  background: white;
  border: 1px solid rgb(44 62 80 / 6%);
  border-radius: 20px;
  box-shadow: 0 2px 12px rgb(44 62 80 / 6%);
  color: var(--deep-slate);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  gap: 10px;
  padding: 12px 20px;
  transition: all 200ms ease;
}

.trust-badge:hover {
  box-shadow: 0 6px 20px rgb(44 62 80 / 10%);
  transform: translateY(-2px);
}

.trust-icon {
  align-items: center;
  background: rgb(174 214 241 / 15%);
  border-radius: 12px;
  display: flex;
  font-size: 1rem;
  height: 36px;
  justify-content: center;
  width: 36px;
}

/* Scroll cue */
.scroll-cue {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 24px;
  opacity: 0.15;
  position: relative;
}

.scroll-cue span {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  opacity: 0.5;
  text-transform: uppercase;
}

.scroll-line {
  animation: scrollPulse 2.2s ease-in-out infinite;
  background: linear-gradient(transparent, var(--deep-slate));
  height: 24px;
  width: 1px;
}

@keyframes scrollPulse {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 1;
  }
}

/* ═══════════════════════════════════════════════
   MOCK SCREENSHOT STYLES
   ═══════════════════════════════════════════════ */
.mock-screen {
  background: var(--cloud-white);
  color: var(--deep-slate);
  display: flex;
  flex-direction: column;
  font-family: Inter, sans-serif;
  font-size: 9px;
  gap: 7px;
  line-height: 1.4;
  overflow: hidden;
  padding: 12px;
  width: 100%;
}

.mock-screen * {
  box-sizing: border-box;
}

/* --- Nook Screen --- */
.mock-greeting {
  font-family: Outfit, sans-serif;
  font-size: 12px;
  font-weight: 700;
}

.mock-greeting span {
  color: var(--heritage-orange);
}

.mock-date {
  color: var(--muted-text);
  font-size: 7.5px;
  margin-top: 1px;
}

.mock-toast {
  background: linear-gradient(135deg, #f15d22 0%, #e67e22 55%, #d4701e 100%);
  border-radius: 11px;
  box-shadow: 0 4px 14px rgb(241 93 34 / 18%);
  color: white;
  overflow: hidden;
  padding: 9px 11px;
  position: relative;
}

.mock-toast::before {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  content: '';
  inset: 0;
  opacity: 0.04;
  pointer-events: none;
  position: absolute;
}

.mock-toast-header {
  align-items: center;
  display: flex;
  gap: 7px;
  position: relative;
}

.mock-toast-icon {
  align-items: center;
  background: rgb(255 255 255 / 18%);
  border-radius: 8px;
  display: flex;
  flex-shrink: 0;
  font-size: 12px;
  height: 26px;
  justify-content: center;
  width: 26px;
}

.mock-toast-title {
  font-family: Outfit, sans-serif;
  font-size: 8px;
  font-weight: 600;
}

.mock-toast-sub {
  font-size: 7px;
  margin-top: 1px;
  opacity: 0.65;
}

.mock-toast-sep {
  background: linear-gradient(
    90deg,
    transparent,
    rgb(255 255 255 / 25%) 20%,
    rgb(255 255 255 / 25%) 80%,
    transparent
  );
  height: 1px;
  margin-top: 6px;
}

.mock-toast-item {
  align-items: center;
  background: rgb(255 255 255 / 10%);
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 8px;
  display: flex;
  gap: 5px;
  margin-top: 4px;
  padding: 4px 6px;
}

.mock-toast-item-icon {
  align-items: center;
  background: rgb(255 255 255 / 12%);
  border-radius: 5px;
  display: flex;
  flex-shrink: 0;
  font-size: 9px;
  height: 18px;
  justify-content: center;
  width: 18px;
}

.mock-toast-item-text {
  flex: 1;
  font-size: 7px;
  font-weight: 500;
  opacity: 0.9;
}

.mock-beans-row {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}

.mock-bean {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mock-bean-avatar {
  align-items: center;
  border: 2px solid;
  border-radius: 50%;
  display: flex;
  height: 24px;
  justify-content: center;
  overflow: hidden;
  width: 24px;
}

.mock-bean-avatar img {
  height: 80%;
  object-fit: contain;
  width: 80%;
}

.mock-bean-name {
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 600;
}

.mock-schedule-row {
  display: flex;
  gap: 6px;
}

.mock-schedule-card {
  background: white;
  border-radius: 11px;
  box-shadow: 0 1px 8px rgb(44 62 80 / 3%);
  flex: 1;
  padding: 8px;
}

.mock-schedule-card--sky {
  border-left: 3px solid var(--sky-silk);
}

.mock-schedule-card--orange {
  border-left: 3px solid var(--heritage-orange);
}

.mock-schedule-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
}

.mock-schedule-label {
  font-family: Outfit, sans-serif;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mock-schedule-badge {
  border-radius: 8px;
  font-family: Outfit, sans-serif;
  font-size: 6px;
  font-weight: 600;
  padding: 2px 5px;
}

.mock-schedule-badge--sky {
  background: rgb(174 214 241 / 20%);
  color: #3a7bad;
}

.mock-schedule-badge--orange {
  color: var(--heritage-orange);
}

.mock-schedule-item {
  align-items: center;
  display: flex;
  gap: 5px;
  padding: 2px 0;
}

.mock-schedule-item-icon {
  align-items: center;
  border-radius: 6px;
  display: flex;
  flex-shrink: 0;
  font-size: 9px;
  height: 20px;
  justify-content: center;
  width: 20px;
}

.mock-schedule-item-icon--sky {
  background: rgb(174 214 241 / 20%);
}

.mock-schedule-item-icon--orange {
  background: rgb(241 93 34 / 8%);
}

.mock-item-title {
  font-family: Outfit, sans-serif;
  font-size: 7.5px;
  font-weight: 600;
}

.mock-item-time {
  color: var(--muted-text);
  font-size: 6.5px;
  opacity: 0.55;
}

/* --- Piggy Bank Screen --- */
.mock-hero-card {
  background: linear-gradient(135deg, #2c3e50, #3d5368);
  border-radius: 11px;
  color: white;
  overflow: hidden;
  padding: 10px 12px;
  position: relative;
}

.mock-hero-card::before {
  background: radial-gradient(circle, rgb(241 93 34 / 15%), transparent 70%);
  border-radius: 50%;
  content: '';
  height: 70px;
  pointer-events: none;
  position: absolute;
  right: -20px;
  top: -20px;
  width: 70px;
}

.mock-hero-label {
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  opacity: 0.5;
  text-transform: uppercase;
}

.mock-hero-amount {
  font-family: Outfit, sans-serif;
  font-size: 20px;
  font-weight: 800;
  margin: 2px 0 1px;
  position: relative;
}

.mock-hero-change {
  align-items: center;
  color: #6ee7b7;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 7px;
  font-weight: 600;
  gap: 3px;
}

.mock-hero-change span {
  color: white;
  opacity: 0.35;
}

.mock-chart-area {
  background: linear-gradient(180deg, rgb(241 93 34 / 10%) 0%, transparent 100%);
  border-radius: 6px;
  height: 44px;
  margin-top: 6px;
  overflow: hidden;
  position: relative;
}

.mock-chart-line {
  bottom: 4px;
  height: 36px;
  left: 0;
  position: absolute;
  right: 0;
}

.mock-period-pills {
  background: rgb(255 255 255 / 8%);
  border-radius: 6px;
  display: flex;
  gap: 2px;
  padding: 2px;
  position: absolute;
  right: 0;
  top: 6px;
}

.mock-period-pill {
  border-radius: 5px;
  color: rgb(255 255 255 / 35%);
  font-family: Outfit, sans-serif;
  font-size: 6px;
  font-weight: 600;
  padding: 2px 5px;
}

.mock-period-pill--active {
  background: rgb(241 93 34 / 40%);
  color: white;
}

.mock-stats-row {
  display: flex;
  gap: 5px;
}

.mock-stat-card {
  background: white;
  border-radius: 10px;
  box-shadow: 0 1px 8px rgb(44 62 80 / 3%);
  flex: 1;
  padding: 7px 8px;
}

.mock-stat-card--dark {
  background: linear-gradient(135deg, #2c3e50, #3d5368);
  color: white;
}

.mock-stat-icon {
  align-items: center;
  border-radius: 6px;
  display: flex;
  font-size: 9px;
  height: 20px;
  justify-content: center;
  margin-bottom: 3px;
  width: 20px;
}

.mock-stat-icon--green {
  background: rgb(39 174 96 / 10%);
}

.mock-stat-icon--orange {
  background: rgb(241 93 34 / 8%);
}

.mock-stat-icon--white {
  background: rgb(255 255 255 / 12%);
}

.mock-stat-label {
  font-family: Outfit, sans-serif;
  font-size: 6px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 1px;
  opacity: 0.4;
  text-transform: uppercase;
}

.mock-stat-amount {
  font-family: Outfit, sans-serif;
  font-size: 11px;
  font-weight: 800;
}

.mock-stat-amount--green {
  color: #27ae60;
}

.mock-stat-amount--orange {
  color: var(--heritage-orange);
}

.mock-accounts-row {
  display: flex;
  gap: 5px;
}

.mock-account-card {
  background: white;
  border-radius: 10px;
  box-shadow: 0 1px 8px rgb(44 62 80 / 3%);
  flex: 1;
  padding: 7px 8px;
}

.mock-account-header {
  align-items: center;
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.mock-account-label {
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  opacity: 0.4;
  text-transform: uppercase;
}

.mock-account-item {
  align-items: center;
  border-bottom: 1px solid rgb(44 62 80 / 4%);
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}

.mock-account-item:last-child {
  border-bottom: none;
}

.mock-account-name {
  font-family: Outfit, sans-serif;
  font-size: 7px;
  font-weight: 600;
}

.mock-account-bal {
  font-family: Outfit, sans-serif;
  font-size: 7px;
  font-weight: 700;
}

/* --- Planner Screen --- */
.mock-planner-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.mock-planner-title {
  font-family: Outfit, sans-serif;
  font-size: 12px;
  font-weight: 700;
}

.mock-planner-sub {
  color: var(--muted-text);
  font-size: 7px;
  margin-top: 1px;
}

.mock-add-btn {
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border: none;
  border-radius: 8px;
  color: white;
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 700;
  padding: 4px 8px;
}

.mock-view-toggle {
  background: rgb(44 62 80 / 5%);
  border-radius: 8px;
  display: flex;
  gap: 2px;
  padding: 2px;
}

.mock-view-btn {
  border-radius: 6px;
  color: var(--muted-text);
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 600;
  padding: 2px 7px;
}

.mock-view-btn--active {
  background: white;
  box-shadow: 0 1px 4px rgb(44 62 80 / 8%);
  color: var(--deep-slate);
}

.mock-member-chips {
  display: flex;
  gap: 3px;
}

.mock-member-chip {
  align-items: center;
  background: white;
  border: 1px solid rgb(44 62 80 / 8%);
  border-radius: 8px;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 600;
  gap: 2px;
  padding: 2px 6px;
}

.mock-member-chip--active {
  background: rgb(241 93 34 / 8%);
  border-color: rgb(241 93 34 / 20%);
  color: var(--heritage-orange);
}

.mock-member-chip-dot {
  border-radius: 50%;
  height: 6px;
  width: 6px;
}

.mock-calendar {
  background: white;
  border-radius: 11px;
  box-shadow: 0 1px 8px rgb(44 62 80 / 3%);
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 6px;
}

.mock-cal-header {
  display: grid;
  gap: 1px;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 3px;
  text-align: center;
}

.mock-cal-day-label {
  color: var(--muted-text);
  font-family: Outfit, sans-serif;
  font-size: 6px;
  font-weight: 600;
  opacity: 0.5;
  padding: 1px 0;
}

.mock-cal-grid {
  display: grid;
  flex: 1;
  gap: 1px;
  grid-template-columns: repeat(7, 1fr);
}

.mock-cal-cell {
  border-radius: 6px;
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 6.5px;
  font-weight: 600;
  min-height: 20px;
  padding: 1px 2px;
  position: relative;
  text-align: center;
}

.mock-cal-cell--today {
  background: rgb(241 93 34 / 8%);
  box-shadow: inset 0 0 0 1.5px var(--heritage-orange);
}

.mock-cal-cell--other {
  opacity: 0.2;
}

.mock-cal-cell--has-events::after {
  background: var(--heritage-orange);
  border-radius: 50%;
  bottom: 2px;
  content: '';
  height: 3px;
  left: 50%;
  position: absolute;
  transform: translateX(-50%);
  width: 3px;
}

.mock-cal-cell--has-events-blue::after {
  background: var(--sky-silk);
  border-radius: 50%;
  bottom: 2px;
  content: '';
  height: 3px;
  left: 50%;
  position: absolute;
  transform: translateX(-50%);
  width: 3px;
}

.mock-cal-cell--has-events-multi::after {
  background: linear-gradient(90deg, var(--heritage-orange), var(--sky-silk));
  border-radius: 2px;
  bottom: 2px;
  content: '';
  height: 3px;
  left: 50%;
  position: absolute;
  transform: translateX(-50%);
  width: 8px;
}

/* ═══════════════════════════════════════════════
   SECTION TRANSITIONS
   ═══════════════════════════════════════════════ */
.section-fade {
  height: 120px;
  pointer-events: none;
  position: relative;
}

.section-fade--to-dark {
  background: linear-gradient(180deg, var(--cloud-white) 0%, var(--deep-slate) 100%);
}

.section-fade--to-light {
  background: linear-gradient(180deg, var(--deep-slate) 0%, var(--cloud-white) 100%);
}

.section-fade--to-story {
  background: linear-gradient(180deg, var(--cloud-white) 0%, #fdf8f5 100%);
}

.section-fade--from-story {
  background: linear-gradient(180deg, #fdf8f5 0%, var(--cloud-white) 100%);
}

.section-fade--hero-out {
  background: linear-gradient(
    180deg,
    var(--cloud-white) 0%,
    var(--cloud-white) 30%,
    var(--deep-slate) 100%
  );
}

.ambient-orb {
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  position: absolute;
}

/* ═══════════════════════════════════════════════
   SECTION SHARED STYLES
   ═══════════════════════════════════════════════ */
.container {
  margin: 0 auto;
  max-width: 960px;
  padding: 0 24px;
}

.section-label {
  color: var(--heritage-orange);
  font-family: Outfit, sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  margin-bottom: 12px;
  text-align: center;
  text-transform: uppercase;
}

.section-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: clamp(1.5rem, 4vw, 2rem);
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 12px;
  text-align: center;
}

.section-subtitle {
  color: var(--muted-text);
  font-size: 0.95rem;
  margin: 0 auto 48px;
  max-width: 520px;
  text-align: center;
}

/* ═══════════════════════════════════════════════
   SECURITY SECTION
   ═══════════════════════════════════════════════ */
.security-section {
  background: var(--deep-slate);
  color: #ecf0f1;
  overflow: hidden;
  padding: 80px 24px;
  position: relative;
}

.security-section .ambient-orb--1 {
  background: var(--sky-silk);
  height: 400px;
  opacity: 0.06;
  right: -150px;
  top: -100px;
  width: 400px;
}

.security-section .ambient-orb--2 {
  background: var(--heritage-orange);
  bottom: -80px;
  height: 300px;
  left: -100px;
  opacity: 0.04;
  width: 300px;
}

.security-section .section-label {
  color: var(--sky-silk);
}

.security-section .section-title {
  color: #ecf0f1;
}

.security-section .section-subtitle {
  color: rgb(236 240 241 / 60%);
}

.security-section__deco-accent {
  left: 40px;
  opacity: 0.03;
  pointer-events: none;
  position: absolute;
  top: 40px;
  width: 45px;
}

.security-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  margin: 0 auto;
  max-width: 800px;
}

.security-card {
  background: rgb(255 255 255 / 6%);
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 20px;
  padding: 24px;
}

.security-card__icon {
  align-items: center;
  background: rgb(174 214 241 / 12%);
  border-radius: 12px;
  display: flex;
  font-size: 1.2rem;
  height: 40px;
  justify-content: center;
  margin-bottom: 14px;
  width: 40px;
}

.security-card__title {
  color: #ecf0f1;
  font-family: Outfit, sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.security-card__text {
  color: rgb(236 240 241 / 55%);
  font-size: 0.82rem;
  line-height: 1.6;
}

.security-section__watermark {
  bottom: 40px;
  opacity: 0.06;
  pointer-events: none;
  position: absolute;
  right: 40px;
  width: 80px;
}

/* ═══════════════════════════════════════════════
   THE BEANIES STORY
   ═══════════════════════════════════════════════ */
.story-section {
  background: #fdf8f5;
  overflow: hidden;
  padding: 100px 24px 0;
  position: relative;
}

.story-section::before {
  background: radial-gradient(ellipse 60% 40% at 50% 20%, rgb(241 93 34 / 4%), transparent 70%);
  content: '';
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.story-section .ambient-orb--1 {
  background: var(--heritage-orange);
  height: 500px;
  opacity: 0.03;
  right: -200px;
  top: 10%;
  width: 500px;
}

.story-section .ambient-orb--2 {
  background: var(--sky-silk);
  bottom: 15%;
  height: 400px;
  left: -150px;
  opacity: 0.04;
  width: 400px;
}

.story-section__deco-accent {
  bottom: 80px;
  opacity: 0.04;
  pointer-events: none;
  position: absolute;
  right: 40px;
  width: 80px;
}

.story-header {
  margin-bottom: 56px;
  position: relative;
  text-align: center;
}

.story-header__illustration {
  margin: 0 auto 24px;
  opacity: 0.9;
  width: 120px;
}

.story__body {
  margin: 0 auto;
  max-width: 640px;
  position: relative;
}

.story__body p {
  color: var(--body-text);
  font-size: 1.02rem;
  line-height: 1.85;
  margin-bottom: 1.5em;
}

.story__greeting {
  border-bottom: 1px solid rgb(44 62 80 / 8%);
  color: var(--deep-slate) !important;
  font-family: Outfit, sans-serif;
  font-size: 1.6rem !important;
  font-weight: 700;
  line-height: 1.4 !important;
  margin-bottom: 1.2em !important;
  padding-bottom: 1em !important;
}

.story__greeting .beanie-emoji {
  display: inline-block;
  font-style: normal;
  margin-left: 4px;
}

.story__highlight {
  background: linear-gradient(transparent 60%, rgb(174 214 241 / 35%) 60%);
  padding: 0 2px;
}

.story__emphasis {
  color: var(--deep-slate);
  font-weight: 600;
}

.story__orange {
  color: var(--heritage-orange);
  font-weight: 600;
}

.story__pinyin-wrap {
  animation: pinyin-float 4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  display: inline-block;
  will-change: transform;
}

.story__pinyin rt {
  color: var(--heritage-orange);
  font-size: 0.55em;
  font-style: italic;
  font-weight: 450;
  letter-spacing: 0.03em;
  opacity: 0.8;
}

@keyframes pinyin-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4px);
  }
}

.story__link {
  border-bottom: 1px solid rgb(241 93 34 / 30%);
  color: var(--heritage-orange);
  font-weight: 500;
  text-decoration: none;
  transition: border-color 200ms ease;
}

.story__link:hover {
  border-bottom-color: var(--heritage-orange);
}

.story__tech-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0 0 1.5em;
  padding: 0;
}

.story__tech-list li {
  align-items: flex-start;
  background: white;
  border: 1px solid rgb(44 62 80 / 6%);
  border-radius: 14px;
  color: var(--body-text);
  display: flex;
  font-size: 0.9rem;
  gap: 10px;
  line-height: 1.6;
  padding: 10px 14px;
}

.story__tech-icon {
  align-items: center;
  background: rgb(174 214 241 / 15%);
  border-radius: 8px;
  display: flex;
  flex-shrink: 0;
  font-size: 0.85rem;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.story__signoff {
  border-top: 1px solid rgb(44 62 80 / 8%);
  margin-top: 48px;
  padding-top: 40px;
  text-align: center;
}

.story__signoff-tagline {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.story__signoff-sub {
  color: var(--heritage-orange);
  font-family: Outfit, sans-serif;
  font-size: 0.9rem;
  font-style: italic;
  font-weight: 300;
  opacity: 0.8;
}

.story__signoff-name {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1rem;
  font-weight: 600;
  margin-top: 24px;
}

.story__signoff-img {
  border-radius: 20px;
  margin: 16px auto 0;
  width: 80px;
}

/* ═══════════════════════════════════════════════
   FINAL CTA
   ═══════════════════════════════════════════════ */
@keyframes ctaBounce {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }

  30% {
    transform: translateY(-12px) rotate(2deg);
  }

  60% {
    transform: translateY(-4px) rotate(-1deg);
  }
}

.final-cta {
  background: linear-gradient(180deg, var(--cloud-white) 0%, #edf6fc 100%);
  overflow: hidden;
  padding: 40px 24px 80px;
  position: relative;
  text-align: center;
}

.final-cta .ambient-orb--1 {
  background: var(--heritage-orange);
  height: 300px;
  opacity: 0.04;
  right: -100px;
  top: -80px;
  width: 300px;
}

.final-cta .ambient-orb--2 {
  background: var(--sky-silk);
  bottom: -60px;
  height: 250px;
  left: -80px;
  opacity: 0.06;
  width: 250px;
}

.final-cta__hero-img {
  animation: ctaBounce 3s ease-in-out infinite;
  display: block;
  filter: drop-shadow(0 8px 24px rgb(241 93 34 / 15%));
  margin: 0 auto 28px;
  opacity: 0.9;
  position: relative;
  width: 320px;
}

.final-cta__deco-accent {
  bottom: 30px;
  left: 40px;
  opacity: 0.05;
  pointer-events: none;
  position: absolute;
  width: 60px;
}

.final-cta__title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: clamp(1.4rem, 3.5vw, 1.8rem);
  font-weight: 700;
  margin-bottom: 8px;
}

.final-cta__title em {
  color: var(--heritage-orange);
  font-style: normal;
}

.final-cta__sub {
  color: var(--muted-text);
  font-size: 0.95rem;
  margin-bottom: 28px;
}

.btn-secondary {
  background: white;
  border: none;
  border: 1px solid rgb(44 62 80 / 8%);
  border-radius: 60px;
  box-shadow: var(--card-shadow);
  color: var(--deep-slate);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 12px 28px;
  text-decoration: none;
  transition: all 200ms ease;
}

.btn-secondary:hover {
  box-shadow: var(--card-hover-shadow);
  transform: translateY(-2px);
}

/* ═══════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════ */
.footer {
  background: var(--deep-slate);
  padding: 32px 24px;
  text-align: center;
}

.footer__brand {
  color: rgb(255 255 255 / 50%);
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.footer__brand-orange {
  color: var(--heritage-orange);
}

.footer__links {
  display: flex;
  gap: 20px;
  justify-content: center;
  margin-top: 8px;
}

.footer__links a {
  color: rgb(255 255 255 / 30%);
  font-size: 0.78rem;
  text-decoration: none;
  transition: color 150ms;
}

.footer__links a:hover {
  color: var(--heritage-orange);
}

.footer__copy {
  color: rgb(255 255 255 / 20%);
  font-size: 0.72rem;
  margin-top: 12px;
}

.footer__tag {
  color: var(--heritage-orange);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-top: 8px;
  opacity: 0.5;
}

.footer__contact-btn {
  align-items: center;
  background: var(--heritage-orange);
  border: none;
  border-radius: 24px;
  color: white;
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 24px;
  transition: all 200ms ease;
}

.footer__contact-btn:hover {
  background: #d14d1a;
  transform: translateY(-1px);
}

/* ═══════════════════════════════════════════════
   CONTACT MODAL
   ═══════════════════════════════════════════════ */
.contact-overlay {
  align-items: center;
  backdrop-filter: blur(8px);
  background: rgb(44 62 80 / 60%);
  display: none;
  inset: 0;
  justify-content: center;
  opacity: 0;
  padding: 24px;
  position: fixed;
  transition: opacity 300ms ease;
  z-index: 500;
}

.contact-overlay.active {
  display: flex;
  opacity: 1;
}

.contact-modal {
  animation: contactSlideIn 300ms ease;
  background: white;
  border-radius: 24px;
  box-shadow: 0 24px 80px rgb(44 62 80 / 20%);
  max-width: 480px;
  padding: 36px;
  position: relative;
  width: 100%;
}

@keyframes contactSlideIn {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.contact-modal__close {
  align-items: center;
  background: rgb(44 62 80 / 6%);
  border: none;
  border-radius: 50%;
  color: var(--body-text);
  cursor: pointer;
  display: flex;
  font-size: 1rem;
  height: 32px;
  justify-content: center;
  position: absolute;
  right: 16px;
  top: 16px;
  transition: background 150ms;
  width: 32px;
}

.contact-modal__close:hover {
  background: rgb(44 62 80 / 12%);
}

.contact-modal__title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.contact-modal__sub {
  color: var(--muted-text);
  font-size: 0.85rem;
  margin-bottom: 24px;
}

.contact-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.contact-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contact-form__label {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  opacity: 0.5;
}

.contact-form__required {
  color: var(--heritage-orange);
  opacity: 1;
}

.contact-form__input,
.contact-form__textarea {
  background: var(--cloud-white);
  border: 1px solid rgb(44 62 80 / 12%);
  border-radius: 14px;
  color: var(--deep-slate);
  font-family: Inter, sans-serif;
  font-size: 0.88rem;
  outline: none;
  padding: 10px 14px;
  transition: border-color 200ms;
}

.contact-form__input:focus,
.contact-form__textarea:focus {
  border-color: var(--heritage-orange);
}

.contact-form__textarea {
  min-height: 100px;
  resize: vertical;
}

.contact-form__submit {
  align-self: flex-start;
  background: linear-gradient(135deg, var(--heritage-orange), var(--terracotta));
  border: none;
  border-radius: 60px;
  box-shadow: 0 4px 16px rgb(241 93 34 / 20%);
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  padding: 12px 28px;
  transition: all 200ms ease;
}

.contact-form__submit:hover {
  box-shadow: 0 6px 24px rgb(241 93 34 / 30%);
  transform: translateY(-1px);
}

.contact-form__submit:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
}

.contact-form__error {
  color: var(--heritage-orange);
  font-size: 0.82rem;
  font-weight: 500;
}

.contact-form__success {
  padding: 24px 0;
  text-align: center;
}

.contact-form__success-icon {
  font-size: 2.5rem;
  margin-bottom: 8px;
}

.contact-form__success-msg {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
}

.contact-form__success-sub {
  color: var(--muted-text);
  font-size: 0.85rem;
  margin-top: 4px;
}

/* ═══════════════════════════════════════════════
   BACK TO TOP
   ═══════════════════════════════════════════════ */
.back-to-top {
  align-items: center;
  backdrop-filter: blur(12px);
  background: rgb(255 255 255 / 85%);
  border: 1px solid rgb(44 62 80 / 10%);
  border-radius: 50%;
  bottom: 28px;
  box-shadow: 0 2px 12px rgb(44 62 80 / 8%);
  color: var(--deep-slate);
  cursor: pointer;
  display: flex;
  font-size: 1rem;
  height: 40px;
  justify-content: center;
  position: fixed;
  right: 28px;
  transition:
    background 200ms,
    transform 200ms,
    box-shadow 200ms;
  width: 40px;
  z-index: 150;
}

.back-to-top:hover {
  background: white;
  box-shadow: 0 4px 16px rgb(44 62 80 / 12%);
  transform: translateY(-2px);
}

.btt-enter-active,
.btt-leave-active {
  transition:
    opacity 300ms ease,
    transform 300ms ease;
}

.btt-enter-from,
.btt-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* ═══════════════════════════════════════════════
   SCROLL REVEAL
   ═══════════════════════════════════════════════ */
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 600ms ease,
    transform 600ms ease;
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}

.reveal-delay-1 {
  transition-delay: 100ms;
}

.reveal-delay-2 {
  transition-delay: 200ms;
}

.reveal-delay-3 {
  transition-delay: 300ms;
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .hero__float {
    animation: none;
  }

  .scroll-cue .scroll-line {
    animation: none;
  }

  .hero__mascot {
    animation: none;
  }

  .hero__deco-img {
    animation: none !important;
  }
}

/* ═══════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════ */
@media (width <= 900px) {
  .fnav {
    flex-wrap: wrap;
    justify-content: center;
    max-width: 95vw;
    padding: 6px 12px 6px 14px;
  }

  .fnav__logo {
    flex-basis: 100%;
    justify-content: center;
  }

  .fnav__right {
    flex-shrink: 0;
  }

  .showcase {
    height: 340px;
  }

  .showcase__device--center {
    width: 280px;
  }

  .showcase__device--left {
    left: -2%;
    width: 250px;
  }

  .showcase__device--right {
    right: -2%;
    width: 250px;
  }

  .hero__float {
    display: none;
  }
}

@media (width <= 640px) {
  .hero {
    padding: 120px 20px 40px;
  }

  .fnav {
    gap: 6px;
    padding: 5px 10px 5px 12px;
  }

  .fnav__logo {
    font-size: 0.85rem;
  }

  .fnav__logo img {
    height: 22px;
    margin-right: 5px;
    width: 22px;
  }

  .fnav__links {
    gap: 0;
  }

  .fnav__links a {
    font-size: 0.75rem;
    padding: 4px 6px;
  }

  .fnav__cta {
    font-size: 0.75rem;
    padding: 5px 12px;
  }

  .showcase {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: auto;
  }

  .showcase__device {
    left: auto !important;
    position: relative !important;
    right: auto !important;
    top: auto !important;
    transform: none !important;
    width: 100% !important;
  }

  .showcase__device:hover {
    transform: translateY(-4px) !important;
  }

  .security-grid {
    grid-template-columns: 1fr;
  }

  .story__body p {
    font-size: 0.95rem;
  }

  .story__tech-list li {
    font-size: 0.84rem;
  }

  .security-section__watermark {
    display: none;
  }

  .trust-row {
    gap: 8px;
  }

  .trust-badge {
    font-size: 0.7rem;
    padding: 8px 14px;
  }

  .trust-icon {
    font-size: 0.85rem;
    height: 28px;
    width: 28px;
  }

  /* Hide decorative brand images on mobile */
  .hero__deco-img {
    display: none;
  }

  .story-section__deco-accent {
    display: none;
  }

  .final-cta__deco-accent {
    display: none;
  }

  .security-section__deco-accent {
    display: none;
  }
}
</style>
