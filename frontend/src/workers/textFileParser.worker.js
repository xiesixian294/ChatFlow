self.onmessage = async (e) => {
  const { file } = e.data
  try {
    const text = await file.text()
    self.postMessage({
      ok: true,
      charCount: text.length,
      preview: text.slice(0, 500),
    })
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || '读取失败' })
  }
}
