const leaf = require('./test-05461.leaf');

test('test-05461', () => {
  const expected = 'test-05461';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
