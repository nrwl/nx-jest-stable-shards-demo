const leaf = require('./test-01484.leaf');

test('test-01484', () => {
  const expected = 'test-01484';
  burn(2571);
  expect(leaf.value).toBe(expected);
});
