const leaf = require('./test-02849.leaf');

test('test-02849', () => {
  const expected = 'test-02849';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
