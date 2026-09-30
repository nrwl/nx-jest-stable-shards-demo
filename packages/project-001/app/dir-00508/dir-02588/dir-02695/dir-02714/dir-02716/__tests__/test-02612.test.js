const leaf = require('./test-02612.leaf');

test('test-02612', () => {
  const expected = 'test-02612';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
