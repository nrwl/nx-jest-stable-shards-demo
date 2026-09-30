const leaf = require('./test-02968.leaf');

test('test-02968', () => {
  const expected = 'test-02968';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
