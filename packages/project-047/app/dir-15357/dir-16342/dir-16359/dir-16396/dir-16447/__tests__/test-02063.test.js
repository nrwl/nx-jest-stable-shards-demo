const leaf = require('./test-02063.leaf');

test('test-02063', () => {
  const expected = 'test-02063';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
