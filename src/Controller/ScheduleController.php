<?php

namespace Drupal\school_schedule\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class ScheduleController extends ControllerBase {

  const CSRF_ID = 'school_schedule';

  const CHILDREN = ['finnley', 'amelia'];

  public function frontend() {
    return [
      '#theme' => 'school_schedule_frontend',
      '#attached' => [
        'library' => ['school_schedule/schedule_ui'],
        'drupalSettings' => [
          'schoolSchedule' => [
            'editable' => FALSE,
            'csrfToken' => \Drupal::csrfToken()->get(self::CSRF_ID),
          ],
        ],
      ],
    ];
  }

  public function admin() {
    return [
      '#theme' => 'school_schedule_admin',
      '#attached' => [
        'library' => ['school_schedule/schedule_ui'],
        'drupalSettings' => [
          'schoolSchedule' => [
            'editable' => TRUE,
            'csrfToken' => \Drupal::csrfToken()->get(self::CSRF_ID),
          ],
        ],
      ],
    ];
  }

  public function apiEndpoint() {
    $database = \Drupal::database();

    $months = $database->select('school_schedule_months', 'm')
      ->fields('m', ['year', 'month'])
      ->orderBy('year')
      ->orderBy('month')
      ->execute()
      ->fetchAll();

    $days = $database->select('school_schedule_days', 'd')
      ->fields('d', ['child', 'day_date', 'is_school_day', 'am_option', 'pm_option', 'parent', 'occasion_text', 'description'])
      ->execute()
      ->fetchAll();

    return new JsonResponse(['months' => $months, 'days' => $days]);
  }

  public function saveDay(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];

    $date = $data['date'] ?? '';
    $child = $data['child'] ?? '';
    $isSchoolDay = !empty($data['is_school_day']);

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Invalid date.'], 400);
    }
    if (!in_array($child, self::CHILDREN, TRUE)) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Invalid child.'], 400);
    }

    $fields = [
      'is_school_day' => $isSchoolDay ? 1 : 0,
      'am_option' => NULL,
      'pm_option' => NULL,
      'parent' => NULL,
      'occasion_text' => NULL,
      'description' => NULL,
    ];

    if ($isSchoolDay) {
      $am = $data['am_option'] ?? '';
      $pm = $data['pm_option'] ?? '';
      $parent = $data['parent'] ?? '';
      if (!in_array($am, ['bus', 'dropoff', 'late_arrival'], TRUE)
        || !in_array($pm, ['bus', 'pickup', 'early_pickup'], TRUE)
        || !in_array($parent, ['eric', 'sarah'], TRUE)) {
        return new JsonResponse(['success' => FALSE, 'message' => 'AM, PM, and Responsible Parent are required for a school day.'], 400);
      }
      $fields['am_option'] = $am;
      $fields['pm_option'] = $pm;
      $fields['parent'] = $parent;
      $description = trim((string) ($data['description'] ?? ''));
      $fields['description'] = ('' !== $description) ? $description : NULL;
    }
    else {
      $occasion = trim((string) ($data['occasion_text'] ?? ''));
      $fields['occasion_text'] = ('' !== $occasion) ? $occasion : NULL;
    }

    \Drupal::database()->merge('school_schedule_days')
      ->keys(['child' => $child, 'day_date' => $date])
      ->fields($fields)
      ->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  public function deleteDay(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $date = $data['date'] ?? '';
    $child = $data['child'] ?? '';

    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) && in_array($child, self::CHILDREN, TRUE)) {
      \Drupal::database()->delete('school_schedule_days')
        ->condition('day_date', $date)
        ->condition('child', $child)
        ->execute();
    }

    return new JsonResponse(['success' => TRUE]);
  }

  public function addMonth(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $year = (int) ($data['year'] ?? 0);
    $month = (int) ($data['month'] ?? 0);

    if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Please provide a valid year and month.'], 400);
    }

    $database = \Drupal::database();
    $exists = $database->select('school_schedule_months', 'm')
      ->condition('year', $year)
      ->condition('month', $month)
      ->countQuery()
      ->execute()
      ->fetchField();

    if ($exists) {
      return new JsonResponse(['success' => FALSE, 'message' => 'That month has already been added.'], 400);
    }

    $database->insert('school_schedule_months')
      ->fields(['year' => $year, 'month' => $month])
      ->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  public function deleteMonth(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $year = (int) ($data['year'] ?? 0);
    $month = (int) ($data['month'] ?? 0);

    $database = \Drupal::database();
    $database->delete('school_schedule_months')
      ->condition('year', $year)
      ->condition('month', $month)
      ->execute();

    $prefix = sprintf('%04d-%02d-', $year, $month);
    $database->delete('school_schedule_days')
      ->condition('day_date', $database->escapeLike($prefix) . '%', 'LIKE')
      ->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  public function copyMonth(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $year = (int) ($data['year'] ?? 0);
    $month = (int) ($data['month'] ?? 0);
    $from = $data['from'] ?? '';
    $to = $data['to'] ?? '';

    if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Please provide a valid year and month.'], 400);
    }
    if (!in_array($from, self::CHILDREN, TRUE) || !in_array($to, self::CHILDREN, TRUE) || $from === $to) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Please choose two different children to copy between.'], 400);
    }

    $database = \Drupal::database();
    $prefix = sprintf('%04d-%02d-', $year, $month);

    $sourceRows = $database->select('school_schedule_days', 'd')
      ->fields('d', ['day_date', 'is_school_day', 'am_option', 'pm_option', 'parent', 'occasion_text', 'description'])
      ->condition('child', $from)
      ->condition('day_date', $database->escapeLike($prefix) . '%', 'LIKE')
      ->execute()
      ->fetchAll();

    $database->delete('school_schedule_days')
      ->condition('child', $to)
      ->condition('day_date', $database->escapeLike($prefix) . '%', 'LIKE')
      ->execute();

    foreach ($sourceRows as $row) {
      $database->merge('school_schedule_days')
        ->keys(['child' => $to, 'day_date' => $row->day_date])
        ->fields([
          'is_school_day' => $row->is_school_day,
          'am_option' => $row->am_option,
          'pm_option' => $row->pm_option,
          'parent' => $row->parent,
          'occasion_text' => $row->occasion_text,
          'description' => $row->description,
        ])
        ->execute();
    }

    return new JsonResponse(['success' => TRUE, 'copied' => count($sourceRows)]);
  }

  public function importData(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $months = $data['months'] ?? [];
    $days = $data['days'] ?? [];

    $database = \Drupal::database();
    $database->truncate('school_schedule_months')->execute();
    $database->truncate('school_schedule_days')->execute();

    foreach ($months as $m) {
      if (empty($m['year']) || empty($m['month'])) {
        continue;
      }
      $database->merge('school_schedule_months')
        ->keys(['year' => (int) $m['year'], 'month' => (int) $m['month']])
        ->execute();
    }

    foreach ($days as $d) {
      if (empty($d['day_date']) || empty($d['child']) || !in_array($d['child'], self::CHILDREN, TRUE)) {
        continue;
      }
      $database->merge('school_schedule_days')
        ->keys(['child' => $d['child'], 'day_date' => $d['day_date']])
        ->fields([
          'is_school_day' => !empty($d['is_school_day']) ? 1 : 0,
          'am_option' => $d['am_option'] ?? NULL,
          'pm_option' => $d['pm_option'] ?? NULL,
          'parent' => $d['parent'] ?? NULL,
          'occasion_text' => $d['occasion_text'] ?? NULL,
          'description' => $d['description'] ?? NULL,
        ])
        ->execute();
    }

    return new JsonResponse(['success' => TRUE]);
  }

  public function clearAll(Request $request) {
    $this->checkCsrf($request);
    $database = \Drupal::database();
    $database->truncate('school_schedule_months')->execute();
    $database->truncate('school_schedule_days')->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  protected function checkCsrf(Request $request) {
    $token = $request->headers->get('X-CSRF-Token', '');
    if (!\Drupal::csrfToken()->validate($token, self::CSRF_ID)) {
      throw new AccessDeniedHttpException('Invalid or missing CSRF token.');
    }
  }

}
