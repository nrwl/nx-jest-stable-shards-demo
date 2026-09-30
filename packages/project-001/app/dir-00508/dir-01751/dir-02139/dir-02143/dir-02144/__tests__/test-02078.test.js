const leaf = require('./test-02078.leaf');

test('test-02078', () => {
  const expected = 'test-02078';
  burn(12102);
  expect(leaf.value).toBe(expected);
});
