const leaf = require('./test-04630.leaf');

test('test-04630', () => {
  const expected = 'test-04630';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
