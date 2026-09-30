const leaf = require('./test-05520.leaf');

test('test-05520', () => {
  const expected = 'test-05520';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
