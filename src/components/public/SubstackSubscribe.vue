<template>
  <div class="subscribe-strip">
    <p class="subscribe-strip-heading">follow me here and get a new beanie blog every friday (well, usually)</p>
    <div class="subscribe-strip-embed-wrap">
      <iframe
        src="https://gpbeanies.substack.com/embed"
        width="100%"
        height="120"
        style=" background: transparent;border: none"
        frameborder="0"
        scrolling="no"
      />
      </div>
  </div>
</template>

<style scoped>
.subscribe-strip {
  --deep-slate: #2c3e50;
  --heritage-orange: #f15d22;
  --terracotta: #e67e22;

  background: linear-gradient(135deg, var(--heritage-orange) 0%, var(--terracotta) 100%);
  border-radius: 20px;
  overflow: hidden;
  padding: 16px 24px;
  text-align: center;
}

.subscribe-strip-heading {
  color: rgb(255 255 255 / 90%);
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 4px;
}

.subscribe-strip-embed-wrap {
  background: rgb(255 255 255 / 15%);
  border-radius: 14px;
  margin-top: 4px;
  padding: 4px;
}

.subscribe-strip-embed-wrap iframe {
  border-radius: 10px;
  display: block;
  width: 100%;
}
</style>
